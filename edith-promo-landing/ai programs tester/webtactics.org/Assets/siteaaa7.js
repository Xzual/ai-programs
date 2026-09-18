/* ============================================================================
   Web Tactics — shared site chrome behavior
   Loaded (deferred) on every page via partials/widgets.php. Handles the
   cross-page behavior that used to be copy-pasted inline into each file:
   fade-up reveals, mobile menu, ambient-audio persistence, page-wipe
   transition, and the custom cursor.
   ========================================================================== */
(function () {
    'use strict';

    /* ===== Scroll-triggered fade-up ===== */
    var fadeEls = document.querySelectorAll('.fade-up');
    if (fadeEls.length) {
        var fadeIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) { e.target.classList.add('in-view'); fadeIO.unobserve(e.target); }
            });
        }, { threshold: 0.15 });
        fadeEls.forEach(function (el) { fadeIO.observe(el); });
    }

    /* Lenis smooth-scroll handle — assigned in the Lenis block below, referenced by
       setMenu so the page behind an open menu can't be smooth-scrolled either. */
    var lenis = null;

    /* ===== Mobile menu ===== */
    var menu = document.getElementById('mobile-menu');
    var ham  = document.getElementById('hamburger');
    function setMenu(open) {
        if (!menu) return;
        menu.classList.toggle('open', open);
        if (ham) ham.classList.toggle('open', open);
        document.body.classList.toggle('menu-open', open);
        // Lock the REAL scroll container. The page scrolls on <html>, not <body>,
        // so `body { overflow:hidden }` alone doesn't stop wheel/touch scroll behind
        // the open menu. Locking documentElement.overflowY does.
        document.documentElement.style.overflowY = open ? 'hidden' : '';
        // Pause Lenis too (desktop): otherwise its rAF keeps applying wheel delta to
        // the page under the overlay. stop()/start() also toggles .lenis-stopped.
        if (lenis) { open ? lenis.stop() : lenis.start(); }
    }
    function toggleMenu() { if (menu) setMenu(!menu.classList.contains('open')); }
    // Expose for any legacy inline onclick="toggleMobileMenu()" still in markup.
    window.toggleMobileMenu = toggleMenu;
    if (ham) ham.addEventListener('click', toggleMenu);
    if (menu) {
        var closeBtn = menu.querySelector('.mobile-close');
        if (closeBtn) closeBtn.addEventListener('click', function () { setMenu(false); });
        menu.querySelectorAll('.m-link').forEach(function (l) {
            l.addEventListener('click', function () { setMenu(false); });
        });
        // Escape closes the open menu (keyboard a11y).
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && menu.classList.contains('open')) setMenu(false);
        });
    }

    /* ===== Lenis smooth scroll (desktop only) =====
       Mirrors the home page & gallery: skip on touch/coarse-pointer devices (native
       momentum is better and the rAF loop is costly) and when the OS asks for reduced
       motion. Guarded on `window.Lenis` so a CDN failure just leaves native scroll. */
    (function () {
        var coarse  = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (coarse || window.innerWidth < 800 || reduced) return;
        if (typeof window.Lenis !== 'function') return;

        lenis = new window.Lenis({ lerp: 0.08, wheelMultiplier: 1, smoothWheel: true });
        window.__lenis = lenis;   // shared name with index.html
        function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
        requestAnimationFrame(raf);

        // Route in-page anchors + the footer "back to top" through Lenis (native
        // scroll-behavior is forced to auto under .lenis-smooth, so these would
        // otherwise teleport / fight Lenis).
        document.addEventListener('click', function (e) {
            var a = e.target.closest('a[href^="#"], .footer-top');
            if (!a) return;
            var href = a.getAttribute('href');
            // "#", the footer top button, or a bare hash → scroll to the top.
            if (a.classList.contains('footer-top') || !href || href === '#') {
                e.preventDefault(); lenis.scrollTo(0, { duration: 1.2 }); return;
            }
            var target = document.getElementById(href.slice(1));
            if (target) { e.preventDefault(); lenis.scrollTo(target, { duration: 1.2, offset: -90 }); }
        });
    })();

    /* ===== Ambient audio persistence ===== */
    (function () {
        var audio = document.getElementById('ambient-audio');
        var btn   = document.getElementById('sound-toggle');
        if (!audio || !btn) return;
        audio.volume = 0.3;
        var unlocked = false;
        var savedTime  = parseFloat(sessionStorage.getItem('wt-audio-time') || '0');
        var wasPlaying = sessionStorage.getItem('wt-audio-playing') === '1';
        if (savedTime > 0 && isFinite(savedTime)) { try { audio.currentTime = savedTime; } catch (e) {} }

        function tryPlay() {
            if (unlocked) return;
            audio.play().then(function () {
                unlocked = true; btn.classList.remove('muted');
                sessionStorage.setItem('wt-audio-playing', '1');
            }).catch(function () {});
        }
        if (wasPlaying) tryPlay();

        var EVENTS = ['click', 'mousedown', 'touchstart', 'keydown', 'pointerdown'];
        function onUserGesture() {
            if (sessionStorage.getItem('wt-audio-playing') !== '0' && wasPlaying) tryPlay();
            if (unlocked) EVENTS.forEach(function (ev) { document.removeEventListener(ev, onUserGesture); });
        }
        EVENTS.forEach(function (ev) { document.addEventListener(ev, onUserGesture, { passive: true }); });

        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (audio.paused) {
                audio.play().then(function () { btn.classList.remove('muted'); unlocked = true; sessionStorage.setItem('wt-audio-playing', '1'); }).catch(function () {});
            } else {
                audio.pause(); btn.classList.add('muted'); sessionStorage.setItem('wt-audio-playing', '0');
            }
        });

        setInterval(function () { if (!audio.paused) sessionStorage.setItem('wt-audio-time', audio.currentTime.toString()); }, 500);
        window.addEventListener('pagehide', function () {
            sessionStorage.setItem('wt-audio-time', audio.currentTime.toString());
            sessionStorage.setItem('wt-audio-playing', audio.paused ? '0' : '1');
        });
    })();

    /* ===== Page transition wipe ===== */
    (function () {
        var wipe = document.getElementById('wt-page-wipe');
        if (!wipe) return;
        // Respect reduced-motion: skip the entry sweep and don't intercept clicks (the
        // overlay is display:none via CSS, so intercepting would just add a dead 650ms delay).
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        function parkWipe() {
            // Snap back to the parked (off-screen) base state with no visible transition,
            // clearing leftover classes AND the inline transform. Without clearing the inline
            // transform, it would permanently outrank the .cover class and the exit wipe would
            // never play (only a silent 650ms delay).
            wipe.style.transition = 'none';
            wipe.classList.remove('cover', 'uncover');
            wipe.style.transform = '';
            requestAnimationFrame(function () { wipe.style.transition = ''; });
        }
        // Entry sweep, then park.
        requestAnimationFrame(function () {
            wipe.classList.add('uncover');
            setTimeout(parkWipe, 750);
        });
        // Intercept same-site navigations to play the exit wipe. Works for extensionless
        // clean URLs (/about, /), legacy .html/.php, and query/hash links; skips external,
        // mailto/tel, downloads, new-tab, same-page anchors, and static-file links.
        document.addEventListener('click', function (e) {
            var link = e.target.closest('a[href]');
            if (!link) return;
            var raw = link.getAttribute('href');
            if (!raw || raw.charAt(0) === '#') return;
            // Modifier-clicks and non-primary buttons belong to the browser — see index.html.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button && e.button !== 0)) return;
            if (e.defaultPrevented) return;
            if (link.target === '_blank' || link.hasAttribute('download')) return;
            if (link.protocol === 'mailto:' || link.protocol === 'tel:') return;
            if (link.hostname !== location.hostname) return;
            if (link.pathname === location.pathname && link.hash) return;
            if (/\.[a-z0-9]+$/i.test(link.pathname) && !/\.(html?|php)$/i.test(link.pathname)) return;
            e.preventDefault();
            wipe.classList.add('cover');
            setTimeout(function () { window.location.href = raw; }, 650);
        });
        // bfcache: a back/forward restore keeps .cover applied (a black overlay). Clear it,
        // and release any menu scroll-lock that was active when the page was cached.
        window.addEventListener('pageshow', function (ev) {
            if (!ev.persisted) return;
            parkWipe();
            if (typeof setMenu === 'function') setMenu(false);
        });
    })();

    /* ===== Magnetic buttons (desktop only) =====
       index.html has had this since launch (setupMagneticButtons, ~line 4835) but it is defined
       inside that page's own script, so every page served through partials/head.php had the class
       and the CSS and nothing bound to them. contact.php:189 wraps its submit button in
       `.magnetic` and has done nothing at all. This is that behaviour, shared.

       Ported deliberately, not reinvented: same 0.35 outer / 0.15 inner pull ratio and the same
       0.5s cubic-bezier(0.16,1,0.3,1) release, so a button behaves identically on /pricing and on
       the homepage. Guards match the cursor block below — coarse pointers get nothing, and
       prefers-reduced-motion is honoured, which the homepage original does NOT check. */
    (function () {
        var coarse  = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (coarse || window.innerWidth < 1024 || reduced) return;

        /* ONLY THE WRAPPER MOVES — the homepage original also translates the inner button by 0.15,
           and that is a bug there rather than a feature worth copying. An inline `transform` beats
           any author rule without !important, so moving the inner element silently kills
           `.pricing-btn-primary:hover { transform: scale(1.04) }`, `-secondary` and
           `.cta-btn:hover { scale(1.05) }` for exactly as long as the pointer is over them — the
           page's most established hover, disabled at the moment of intent. Moving only the wrapper
           gives the same magnetic pull and leaves every :hover scale intact. */
        var EASE = 'transform 0.5s cubic-bezier(0.16,1,0.3,1)';
        document.querySelectorAll('.magnetic').forEach(function (el) {
            el.addEventListener('mousemove', function (e) {
                var r = el.getBoundingClientRect();
                var dx = e.clientX - (r.left + r.width / 2);
                var dy = e.clientY - (r.top + r.height / 2);
                el.style.transform = 'translate(' + (dx * 0.35) + 'px,' + (dy * 0.35) + 'px)';
            });
            el.addEventListener('mouseleave', function () {
                el.style.transition = EASE;
                el.style.transform = '';
                setTimeout(function () { el.style.transition = ''; }, 500);
            });
        });
    })();

    /* ===== Custom cursor (desktop only) ===== */
    (function () {
        if (window.innerWidth < 1024) return;
        var dot = document.getElementById('wt-cursor-dot');
        var ring = document.getElementById('wt-cursor-ring');
        var glow = document.getElementById('wt-cursor-glow');   // soft trail-glow (matches home)
        if (!dot || !ring) return;
        // Signal to site.css that a replacement cursor exists, so it may hide the system one.
        document.documentElement.classList.add('wt-cursor-ready');
        var lastX = 0, lastY = 0, glowActive = false, glowFade;
        document.addEventListener('mousemove', function (e) {
            var vel = Math.sqrt((e.clientX - lastX) * (e.clientX - lastX) + (e.clientY - lastY) * (e.clientY - lastY));
            var angle = Math.atan2(e.clientY - lastY, e.clientX - lastX);
            lastX = e.clientX; lastY = e.clientY;
            dot.style.left = e.clientX + 'px';
            dot.style.top = e.clientY + 'px';
            var stretch = Math.min(1 + vel * 0.02, 2.0);
            setTimeout(function () {
                ring.style.transform = 'translate(-50%,-50%) translate(' + e.clientX + 'px,' + e.clientY + 'px) rotate(' + angle + 'rad) scaleX(' + stretch + ')';
            }, 40);
            if (glow) {
                glow.style.left = e.clientX + 'px';
                glow.style.top = e.clientY + 'px';
                if (!glowActive && vel > 3) { glow.classList.add('active'); glowActive = true; }
                clearTimeout(glowFade);
                glowFade = setTimeout(function () { glow.classList.remove('active'); glowActive = false; }, 200);
            }
        });
        // .metric, .step, .testi-card and .results-band .rb were added 10 Aug 2026 — they all lift on
        // hover now, and without registering them here the cursor ring stayed small over the exact
        // elements that had just started responding, which is the mismatch the change existed to remove.
        document.querySelectorAll('a, button, input, textarea, .interactable, .case-card, .pricing-card, .blog-card, .value-card, .addon-card, .filter-tab, .cta-btn, .faq-question, .metric, .step, .testi-card, .results-band .rb').forEach(function (el) {
            el.addEventListener('mouseenter', function () { document.body.classList.add('wt-hovering'); });
            el.addEventListener('mouseleave', function () {
                document.body.classList.remove('wt-hovering');
                ring.style.transform = ring.style.transform.replace(/scaleX\([^)]*\)/, 'scaleX(1)');
            });
        });
    })();

    /* Currency toggle removed — Stripe/shop retired; prices are no longer displayed. */

    /* ===== Dubai clock (nav) ===== */
    (function () {
        var el = document.getElementById('dubai-time');
        if (!el) return;
        function update() {
            el.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' });
        }
        update();
        setInterval(update, 30000);
    })();
})();

/* ── COMPANY WEBSITE: accept what people actually type ────────────────────────────────────────
   These fields were `type="url"`, which is a browser VALIDITY CONSTRAINT, not a hint: it requires a
   scheme, so "www.example.com" was rejected and the form would not submit until the visitor typed
   "https://" themselves. Both forms are real <form>s without novalidate, so there was no way past it.
   Reported from the live site on 25 Aug 2026.

   They are `type="text"` now — `inputmode="url"` still gives a phone the URL keyboard — and this adds
   the scheme on the way out instead of demanding it on the way in. The field is optional and stays
   optional: an empty value is left completely alone. */
(function () {
    function tidyUrl(v) {
        v = (v || '').trim();
        if (!v) { return ''; }                       // optional: never invent a value
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) { return v; }   // already has a scheme
        if (/^\/\//.test(v)) { return 'https:' + v; }           // protocol-relative
        return 'https://' + v.replace(/^\/+/, '');
    }
    window.wtTidyUrl = tidyUrl;

    document.addEventListener('submit', function (e) {
        var f = e.target;
        if (!f || !f.querySelectorAll) { return; }
        f.querySelectorAll('input[name="website"]').forEach(function (i) { i.value = tidyUrl(i.value); });
    }, true);   // capture, so the value is tidy before any handler reads it
}());
