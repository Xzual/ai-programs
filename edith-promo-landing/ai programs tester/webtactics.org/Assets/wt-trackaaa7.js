/* Web Tactics — unified browser tracking. One event, three destinations:
   Meta Pixel (browser), Meta CAPI (/api/track.php, sharing an event_id so Meta can deduplicate),
   and GA4 via gtag.

   THE GUARD USED TO BE `if (typeof window.fbq === 'undefined') return;` — a single early exit for
   the whole file. That was fine while Meta was the only destination, but it means a visitor whose
   ad blocker eats connect.facebook.net (common — blocklists target Facebook far harder than Google)
   produced NO tracking of any kind. With GA4 added, that would have silently thrown away analytics
   and Google Ads conversions for a large slice of real traffic. Each destination is now guarded
   individually inside track(), so losing one never takes the others down. */
(function () {

    var CAPI_URL = 'api/track.html';
    var pg = (document.title || '').split('|')[0].trim() || location.pathname;
    var fired = {};

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    /* ---------- campaign attribution ----------
       Captured on the LANDING page and kept for the session, because reading the query string at
       submit time would attribute almost every real lead to nothing: a visitor arrives on an ad,
       browses two or three pages, and by the time they open a form the utm_* parameters are long gone
       from the URL. sessionStorage rather than localStorage so a later organic visit is not
       misattributed to a campaign the visitor saw days ago.
       Exposed as window.wtUtm() for the lead forms to include in their payload. */
    var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    (function captureUtm() {
        try {
            var q = new URLSearchParams(location.search), found = {}, any = false;
            for (var i = 0; i < UTM_KEYS.length; i++) {
                var v = q.get(UTM_KEYS[i]);
                if (v) { found[UTM_KEYS[i]] = String(v).slice(0, 160); any = true; }
            }
            // Only overwrite when this page load actually carries campaign parameters — otherwise the
            // first internal click would wipe the attribution it was meant to preserve.
            if (any) sessionStorage.setItem('wt_utm', JSON.stringify(found));
        } catch (_) {}
    })();
    window.wtUtm = function () {
        try { return JSON.parse(sessionStorage.getItem('wt_utm') || '{}') || {}; } catch (_) { return {}; }
    };
    function getCookie(name) {
        var m = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]+)'));
        return m ? decodeURIComponent(m[2]) : null;
    }
    function ensureFbc() {
        var existing = getCookie('_fbc');
        if (existing) return existing;
        var fbclid = new URLSearchParams(location.search).get('fbclid');
        return fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : null;
    }

    // Meta's event vocabulary -> GA4's. Only the commercially meaningful ones are mapped; the rest
    // fall through to a snake_cased passthrough so nothing is silently dropped when a new event is
    // added to the click delegation below.
    var GA4_NAMES = {
        Lead:             'generate_lead',
        FormSubmit:       'generate_lead',
        Contact:          'contact',
        Subscribe:        'sign_up',
        ViewContent:      'view_item',
        // begin_checkout is a RECOMMENDED GA4 event; initiate_checkout (what the snake_case
        // passthrough produced) is not. That distinction is the whole reason the 26+ "Get an
        // estimate" buttons could not be turned into an Ads conversion without new code: Google Ads
        // only offers GA4 events it recognises when you import a conversion, so the funnel's first
        // real commercial step arrived as an opaque custom event nobody could bid on.
        InitiateCheckout: 'begin_checkout'
    };
    function snake(n) {
        return String(n).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9_]/g, '_').toLowerCase();
    }

    // ── Google Ads conversions ──────────────────────────────────────────────────────────────────
    // Fired from the same place as Meta and GA4, so the three can never drift apart as the click
    // delegation below grows.
    //
    // Keyed on "<event>:<method>" first, then bare "<event>". That is how one Contact click resolves
    // to either the WhatsApp or the email action, while Contact:phone — for which no conversion
    // action exists — resolves to nothing instead of being mis-attributed to one of the others.
    //
    // `Lead` alone maps to Brief Submitted. `FormSubmit` deliberately does NOT: it is the fallback
    // for a form that is neither the newsletter nor the brief, so counting it would inflate the very
    // number Smart Bidding optimises against.
    //
    // No `value` is sent. Each action is configured "use the same value for each conversion" in the
    // Ads UI; passing a value here would override that and silently diverge from what is configured
    // there, with no error anywhere.
    var ADS_ID = 'AW-312347350';
    var ADS_CONVERSIONS = {
        'Lead':             '2SwzCODu790cENaV-JQB',
        'Contact:whatsapp': 'L07MCOPu790cENaV-JQB',
        'Contact:email':    'kbsbCObu790cENaV-JQB'

        // TWO MORE ARE WORTH HAVING and have no label because the actions do not exist in the Ads
        // account yet: InitiateCheckout (every "Get an estimate" / "Book a call" CTA) and Subscribe
        // (the blog newsletter). Both already reach GA4 under Google's recommended names —
        // begin_checkout and sign_up — so they can be imported as conversions from GA4 with no code
        // change at all, which is the quicker route. To wire them directly instead, create the
        // action in Google Ads (Goals -> Conversions -> New -> Website -> "Add manually using code")
        // and add the label here:
        //     'InitiateCheckout': '<label>',
        //     'Subscribe':        '<label>',
        // Do NOT add them with an empty string as a placeholder: adsLabel() would return '' as
        // falsy and skip, but a whitespace or partial paste would produce send_to
        // 'AW-312347350/' and ping a malformed destination on every CTA click, silently.
    };

    // Pages where a contact click is not a commercial signal.
    //
    // The floating WhatsApp widget and the footer mailto are sitewide, so they sit on /privacy and
    // /terms too — meaning someone reading the terms of use fired exactly the same Google Ads
    // conversion as someone on /pricing. Once real money is bidding against those numbers that is
    // not a rounding error, it is a bid signal pointing at the wrong traffic.
    //
    // Only the ADS ping is suppressed. The Meta and GA4 events still fire everywhere, because the
    // click genuinely happened and is worth having in the reports — what must not happen is Smart
    // Bidding treating it as a lead.
    var ADS_MUTED = ['/privacy', '/terms', '/thank-you'];
    function adsMuted() {
        // A page can also mute itself, which is the ONLY thing that works for the 404 page.
        // '/404' used to be in the list above and could never match: `.htaccess` uses
        // `ErrorDocument 404 /404.html`, an INTERNAL handler, so the error page is served at the
        // ORIGINALLY REQUESTED path. location.pathname on a real 404 is '/mistyped-thing', never
        // '/404' — measured on production: requesting /pricng gave pathname "/pricng" and a tap on
        // the floating WhatsApp button fired AW-312347350/L07MCOPu790cENaV-JQB. The list entry only
        // ever matched a visitor who typed /404.html by hand, which is nobody. That mattered because
        // a stale ad final URL lands exactly there: the one visitor who reached nothing at all was
        // the one whose WhatsApp tap was reported to Smart Bidding as a conversion.
        // A flag set by the page itself cannot be defeated by URL rewriting, and it covers the
        // direct /404.html visit too, so the list entry is gone rather than kept alongside it.
        if (window.WT_ADS_MUTED === true) return true;
        var p = location.pathname.toLowerCase().replace(/\.(html|php)$/, '').replace(/\/+$/, '');
        for (var i = 0; i < ADS_MUTED.length; i++) if (p === ADS_MUTED[i]) return true;
        return false;
    }

    function adsLabel(name, custom) {
        if (adsMuted()) return null;
        return ADS_CONVERSIONS[name + ':' + ((custom && custom.method) || '')]
            || ADS_CONVERSIONS[name] || null;
    }

    function track(eventName, custom, userData, isCustom) {
        custom = custom || {};
        if (!custom.page) custom.page = pg;
        var eventId = uuid();

        // 1. Meta Pixel — guarded, because it may be blocked or still loading.
        try {
            if (typeof window.fbq === 'function') {
                window.fbq(isCustom ? 'trackCustom' : 'track', eventName, custom, { eventID: eventId });
            }
        } catch (_) {}

        // 2. GA4. Event names are snake_cased because that is the GA4 convention and its reports are
        // case-sensitive, and the three that matter commercially are mapped onto Google's RECOMMENDED
        // names — generate_lead, contact, sign_up. That matters beyond tidiness: Google Ads
        // recognises recommended events when importing GA4 conversions, so a lead imports as a lead
        // rather than as an opaque custom event nobody can bid on.
        try {
            if (typeof window.gtag === 'function') {
                window.gtag('event', GA4_NAMES[eventName] || snake(eventName), custom);
            }
        } catch (_) {}

        // 3. Google Ads conversion, for the three events that map to one. Same gtag, same moment.
        try {
            if (typeof window.gtag === 'function') {
                var lbl = adsLabel(eventName, custom);
                if (lbl) window.gtag('event', 'conversion', { send_to: ADS_ID + '/' + lbl });
            }
        } catch (_) {}

        try {
            var ud = {};
            for (var k in (userData || {})) if (userData[k]) ud[k] = userData[k];
            var fbp = getCookie('_fbp'); if (fbp) ud.fbp = fbp;
            var fbc = ensureFbc();      if (fbc) ud.fbc = fbc;

            var body = JSON.stringify({
                event_name: eventName,
                event_id: eventId,
                event_time: Math.floor(Date.now() / 1000),
                event_source_url: location.href,
                action_source: 'website',
                custom_data: custom,
                user_data: ud
            });
            var blob = new Blob([body], { type: 'application/json' });
            if (!navigator.sendBeacon || !navigator.sendBeacon(CAPI_URL, blob)) {
                fetch(CAPI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: blob, keepalive: true }).catch(function () {});
            }
        } catch (_) {}
    }
    window.wtTrack = track;

    /* ---------- click delegation ----------
       Intent is resolved from WHERE a click goes, not from what the button says.

       It used to be the other way round, and text matching had put three separate holes in the
       funnel:

       * "Get an estimate" — the primary CTA, appearing 26+ times across /pricing and all seven
         service pages, every one of them pointing at /start — matched no clause in the regex. The
         copies carrying `class="pricing-btn"` were caught by the class check; the copies using
         `class="cta-btn"` fell through to a CTAClick, which is not a funnel event. So four visually
         identical buttons emitted three different things depending on wording and class.
       * The four in-article links to /start inside blog posts fired NOTHING. No class, no matching
         text, and internal — so they missed every clause including the outbound one. Those are the
         mid-funnel clicks from the pages SEO actually lands on, and they were invisible.
       * ViewContent never fired from a listing page at all. `.case-card` and `.blog-card` are on the
         wrapping <div>/<article>, but this handler resolves e.target up to the nearest `a, button` —
         whose className is `case-link` or `blog-read`. The class test could therefore never match,
         on either listing page, since the day it was written. `closest()` is what it needed.

       A destination cannot be misspelled the way a label can, and a new CTA is instrumented the
       moment it points somewhere real. */

    /** Same-origin pathname a link resolves to, lowercased and de-slashed; null if not internal. */
    function destOf(el, raw) {
        // A pure fragment or a javascript: href resolves to the CURRENT pathname, which would make
        // an in-page anchor on /start look like a click TOWARDS /start.
        if (!raw || raw.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(raw)) return null;
        try {
            var u = new URL(el.href%20__%20raw%2c%20location.href.html);
            if (u.host !== location.host) return null;
            return u.pathname.toLowerCase().replace(/\.(html|php)$/, '').replace(/\/+$/, '') || '/';
        } catch (_) { return null; }
    }

    document.addEventListener('click', function (e) {
        // `a, button` alone was too narrow to reach the homepage's project cards: each one is a
        // <div class="h-project" onclick="openModal(…)"> with a bare <div class="h-project-click">
        // stretched over it to catch the pointer. Neither is an anchor or a button, so this handler
        // returned on its first line for all seven of them — opening a project modal, which is a
        // real content view, recorded nothing.
        var el = e.target.closest && e.target.closest('a, button, [data-wt-event], .h-project'); if (!el) return;
        var raw  = el.getAttribute('href') || '';
        var href = raw.toLowerCase();
        var text = (el.innerText || el.textContent || '').trim().slice(0, 80);
        var cls  = (el.className && el.className.toString) ? el.className.toString() : '';

        // 0a. An element that fires its own event opts out, exactly as a form does. Gallery.html's
        //     end-of-corridor and lightbox CTAs each call wtTrack('InitiateCheckout', …) from an
        //     inline onclick; once intent is read from the destination, the /start lightbox CTA would
        //     ALSO be classified here and one click would count as two conversions. Text matching hid
        //     that — "Start a project like this →" happened not to match the old regex, which wanted
        //     the literal "start project".
        if (el.closest('[data-wt-manual-track]')) return;

        // 0b. Explicit override always wins, so any future element can state its own event and never
        //     depend on inference: <a data-wt-event="Lead" data-wt-method="…">
        var owner = el.closest('[data-wt-event]');
        if (owner) {
            var name = owner.getAttribute('data-wt-event');
            if (name) return track(name, {
                content_name: owner.getAttribute('data-wt-name') || text || 'element',
                method: owner.getAttribute('data-wt-method') || undefined
            }, null, !GA4_NAMES[name]);
        }

        // 1. Leaving the site for a channel we can be reached on. These outrank everything below:
        //    a WhatsApp button inside a pricing card is a contact, not a pricing click.
        if (href.indexOf('wa.html') > -1 || href.indexOf('api.whatsapp') > -1)
            return track('Contact', { method: 'whatsapp', source: el.id || (cls.split(' ')[0]) || 'link' });
        if (href.indexOf('mailto:') === 0) return track('Contact', { method: 'email' });
        if (href.indexOf('tel:') === 0)    return track('Contact', { method: 'phone' });

        var socials = { 'instagram.com': 'instagram', 'linkedin.com': 'linkedin', 'youtube.com': 'youtube', 'facebook.com': 'facebook', 'tiktok.com': 'tiktok', 'twitter.com': 'twitter', 'x.com': 'x' };
        for (var d in socials) if (href.indexOf(d) > -1) return track('SocialClick', { network: socials[d] }, null, true);

        if (el.id === 'hamburger') return track('MobileMenuToggle', {}, null, true);

        // 2. Site chrome. Detected by CONTAINER, not by class: the footer links to /service four
        //    times and to /pricing once, and the mobile menu uses `m-link` where the desktop nav uses
        //    `nav-link` (only the latter was ever checked). Without this, every footer column would
        //    manufacture funnel events on pages the visitor was merely leaving.
        var chrome = el.closest('nav, footer, .mobile-menu, .nav-right');
        if (chrome || (el.classList && (el.classList.contains('nav-link') || el.classList.contains('m-link') || el.classList.contains('logo'))))
            return track('NavClick', { label: text, region: chrome ? (chrome.tagName || '').toLowerCase() || 'menu' : 'link' }, null, true);

        // 3. Intent, by destination.
        var dest = destOf(el, raw);
        if (dest === '/start')
            return track('InitiateCheckout', { content_name: text || 'get an estimate', source: location.pathname });
        // /estimate is the SAME funnel step as /start reached a different way, so it fires the same
        // event rather than a new one — one conversion action in Ads, one funnel in GA4, and the two
        // routes still separable by content_type. This clause is not cosmetic: the primary "Get an
        // estimate" CTA on all eight service pages now points here, and without it every one of those
        // clicks would fall through to the generic clauses below and stop being a funnel event at all.
        if (dest === '/estimate')
            return track('InitiateCheckout', { content_name: text || 'build a package', content_type: 'calculator', source: location.pathname });
        if (dest === '/service')
            return track('ViewContent', { content_type: 'service', content_name: text });
        if (dest === '/pricing')
            return track('ViewContent', { content_type: 'pricing', content_name: text });

        // 4. Listing cards -> ViewContent. `closest` because the class lives on the card wrapper,
        //    never on the link that was clicked: /blog renders
        //    <article class="blog-card">…<a class="blog-read">Read Article →</a></article>.
        //
        //    `.case-card` is deliberately NOT in this list. Those cards on /case-studies contain no
        //    link and no onclick — they are inert content blocks. Firing "viewed a case study" from
        //    a click that does nothing at all would be inventing engagement, not measuring it. If
        //    that page should report views, the cards need to become links first.
        var card = el.closest('.h-project, .blog-card, .article-card');
        if (card) {
            var ccls = (card.className || '') + '';
            var isBlog = ccls.indexOf('blog-card') > -1 || ccls.indexOf('article-card') > -1;
            // The link text is "Read Article →" on every blog card, which identifies nothing. The
            // card's own heading is the content name worth reporting.
            var head = card.querySelector('h2, h3');
            return track('ViewContent', {
                content_type: isBlog ? 'blog' : 'case_study',
                content_name: (head && head.textContent.trim().slice(0, 120)) || text
            });
        }

        // 5. In-article links to the rest of the site. Not conversions — a named, non-conversion
        //    event so internal linking inside blog posts stops being a blind spot. Scoped to prose,
        //    so this cannot become an event on every link on the site.
        if (dest && el.closest('.post-content, article.post-content, .post-body')) {
            return track('InternalLink', { to: dest, label: text, from: location.pathname }, null, true);
        }

        // 6. Backstops. A CTA that points nowhere useful yet is still worth seeing.
        //    classList.contains, not indexOf: "cta-btn" is a SUBSTRING of Gallery.html's
        //    "end-cta-btn", so the old test matched classes it was never meant to.
        if (el.classList && (el.classList.contains('pricing-btn') || el.classList.contains('cta-btn')))
            return track('CTAClick', { label: text, to: dest || href || 'none' }, null, true);

        if (el.tagName === 'A' && href && !/^(#|\/|javascript:|mailto:|tel:)/.test(href)) {
            try {
                var u = new URL(el.href%2c%20location.href.html);
                if (u.host && u.host !== location.host) track('OutboundClick', { url: u.href }, null, true);
            } catch (_) {}
        }
    }, true);

    /* ---------- form submit + PII extraction ---------- */
    function extractPII(form) {
        var pii = {};
        var emailEl = form.querySelector('input[type=email], input[name*=mail i]');
        // `input[type=tel]` FIRST is not enough on its own: querySelector returns the first match in
        // DOCUMENT order across the whole selector list, and start.php has an
        // <input type="checkbox" name="phone_on_whatsapp"> that matches both the phone and whatsapp
        // clauses. It is currently saved only by sitting after the real tel input in source order —
        // reorder that markup and pii.phone silently becomes the checkbox's value string. Excluding
        // checkboxes makes the selector say what it means.
        var phoneEl = form.querySelector('input[type=tel]:not([type=checkbox]), input[name*=phone i]:not([type=checkbox]), input[name*=mobile i]:not([type=checkbox]), input[name*=whatsapp i]:not([type=checkbox])');
        var nameEl  = form.querySelector('input[name*=name i]:not([name*=company i]):not([name*=brand i]):not([name*=user i])');
        if (emailEl && emailEl.value) pii.email = emailEl.value.trim().toLowerCase();
        // E.164, not bare digits. Meta and Google match hashed phone numbers in E.164, so a UAE
        // visitor typing the local "050 902 7130" was hashed as "0509027130" and matched NOTHING at
        // either — every phone-based enhanced-matching signal was silently wasted. wtPhone.normalise
        // never throws and falls back to bare digits, so a missing wt-phone.js costs matching quality
        // and nothing else.
        if (phoneEl && phoneEl.value) {
            pii.phone = window.wtPhone ? window.wtPhone.normalise(phoneEl.value, '971')
                                       : phoneEl.value.replace(/\D/g, '');
        }
        if (nameEl && nameEl.value) {
            var parts = nameEl.value.trim().split(/\s+/);
            if (parts.length)     pii.first_name = parts[0].toLowerCase();
            if (parts.length > 1) pii.last_name  = parts.slice(1).join(' ').toLowerCase();
        }
        return pii;
    }

    document.addEventListener('submit', function (e) {
        var f = e.target; if (!f || f.tagName !== 'FORM') return;
        // A form can opt out and fire its own event instead. This exists because the delegate runs
        // in the CAPTURE phase — before the page's own handler and therefore before its fetch() —
        // so a form that submits over the network counted a Lead even when delivery FAILED, while
        // the two pseudo-forms fire only on success. Same Ads conversion action, two different
        // definitions of a lead. /start opts out and fires on success, matching the others.
        if (f.hasAttribute('data-wt-manual-track')) return;
        var id  = (f.id || '').toLowerCase();
        var cls = ((f.className || '') + '').toLowerCase();
        var pii = extractPII(f);

        if (id.indexOf('newsletter') > -1 || cls.indexOf('newsletter') > -1)
            return track('Subscribe', { content_name: 'newsletter' }, pii);
        if (id.indexOf('contact') > -1 || cls.indexOf('contact') > -1 || f.querySelector('textarea'))
            return track('Lead', { content_name: 'contact_form' }, pii);
        track('FormSubmit', { form_id: f.id || 'unknown' }, pii, true);
    }, true);

    /* ---------- scroll depth ----------
       rAF-gated, and it removes itself once the last threshold has fired.
       This file is loaded on both WebGL pages, where scroll IS the input device: the gallery's
       corridor walk runs on a ~1600vh runway and a held d-pad button writes window.scrollY every
       animation frame, so every one of those frames used to land here and read
       document.documentElement.scrollHeight — a forced synchronous layout inside the same frame as
       the Three.js render. index.html explicitly caches that same read elsewhere with the comment
       "reading scrollHeight forces a layout". Worse, after 90% the thresholds all short-circuit but
       the reflow kept happening for the rest of the session, doing no work at all. */
    var _sdQueued = false;
    function depth() {
        _sdQueued = false;
        var s = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100;
        [25, 50, 75, 90].forEach(function (d) {
            var k = 'sd' + d;
            if (s >= d && !fired[k]) { fired[k] = true; track('ScrollDepth', { depth: d }, null, true); }
        });
        if (fired.sd90) window.removeEventListener('scroll', onScrollDepth);
    }
    function onScrollDepth() {
        if (_sdQueued) return;
        _sdQueued = true;
        requestAnimationFrame(depth);
    }
    window.addEventListener('scroll', onScrollDepth, { passive: true });

    /* ---------- time on page ---------- */
    [30, 60, 120].forEach(function (s) {
        setTimeout(function () { track('TimeOnPage', { seconds: s }, null, true); }, s * 1000);
    });

    /* ---------- video play ---------- */
    document.addEventListener('play', function (e) {
        if (e.target && e.target.tagName === 'VIDEO')
            track('VideoPlay', { src: e.target.currentSrc || e.target.src || '' }, null, true);
    }, true);
})();
