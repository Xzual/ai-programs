/* Web Tactics — country-aware phone parsing and E.164 normalisation.
   Loaded on every page that carries a lead form. No dependencies, no build step.

   WHY THIS EXISTS, AND WHY NOT libphonenumber
   The three lead forms previously shared one rule: /^\+?[0-9]{7,15}$/ after stripping spaces,
   hyphens and parentheses. That accepted "+9710501234567" (a real, very common paste error — the
   trunk 0 left in after the country code), accepted any 7 digits from anywhere, REJECTED
   "050.902.7130" because dots were not stripped, and knew nothing about which country a number
   belongs to. /start validated nothing at all.

   libphonenumber is the correct answer to this problem in general and the wrong one here: it is
   ~150KB for a site with no build step that vendors exactly one dependency (Lenis). This file
   encodes the plans that actually matter to a Dubai studio in ~4KB, and — crucially — DEGRADES
   PERMISSIVELY for every plan it does not encode.

   THE SECOND JOB, WHICH MATTERS MORE THAN VALIDATION
   Meta and Google match hashed phone numbers in E.164. Before this file, a UAE visitor typing
   "050 902 7130" was hashed as "0509027130" and matched nothing, so every enhanced-matching signal
   from a phone number was silently wasted. normalise() is what fixes that; validation is the
   secondary benefit.

   DESIGN RULE: an over-strict phone check silently kills real leads, which is strictly worse than
   the loose rule it replaces. So an unrecognised dialling code is ACCEPTED (6-14 national digits),
   flagged `country: 'unknown'`, and reported to the owner in the form payload rather than blocked.
*/
(function () {
    'use strict';

    // ── Dialling plans ──────────────────────────────────────────────────────────────────────────
    // `nsn` = national significant number, i.e. after the country code and after any trunk prefix
    // is stripped. `trunk` is the digit dropped when a local-format number is internationalised.
    // Confidence is recorded per entry because these are real-world numbering plans, they change,
    // and the next person needs to know which lines are safe to tighten. Checked Aug 2026.
    var PLANS = [
        {
            // 9 for mobile, 8 for landline — both are valid and a Dubai office number is 8
            // ("+971 4 397 1234"). Allowing only 9 rejected every landline in the country.
            cc: '971', iso: 'AE', name: 'UAE', trunk: '0', nsn: [8, 9],
            // Mobile: 2-digit prefix + 7 subscriber digits. The set {50,52,54,55,56,58} is high
            // confidence; 57 is believed unassigned and is the first candidate to add if a real
            // lead is ever rejected. MVNOs (e.g. Virgin) sit inside 058x, so they need no entry.
            mobile: /^5[024568]\d{7}$/,
            // Landline: single-digit area code + 7. 2 Abu Dhabi, 3 Al Ain, 4 Dubai,
            // 6 Sharjah/Ajman/UAQ, 7 Ras Al Khaimah, 9 Fujairah.
            landline: /^[234679]\d{7}$/,
            hint: 'UAE mobiles are +971 then 50, 52, 54, 55, 56 or 58 and 7 more digits.'
        },
        { cc: '966', iso: 'SA', name: 'Saudi Arabia', trunk: '0', nsn: [9],
          mobile: /^5\d{8}$/, landline: /^1\d{8}$/,
          hint: 'Saudi mobiles are +966 then 5 and 8 more digits.' },
        { cc: '965', iso: 'KW', name: 'Kuwait', trunk: '', nsn: [8],
          mobile: /^[569]\d{7}$/, landline: /^2\d{7}$/,
          hint: 'Kuwait numbers are +965 then 8 digits starting 5, 6, 9 (mobile) or 2 (landline).' },
        { cc: '974', iso: 'QA', name: 'Qatar', trunk: '', nsn: [8],
          mobile: /^[3567]\d{7}$/, landline: /^4\d{7}$/,
          hint: 'Qatar numbers are +974 then 8 digits starting 3, 5, 6, 7 (mobile) or 4 (landline).' },
        // Bahrain: mobile 3x is high confidence; some 6x ranges are also mobile/data, which is
        // LOWER confidence — both are accepted rather than risk rejecting a real number.
        { cc: '973', iso: 'BH', name: 'Bahrain', trunk: '', nsn: [8],
          mobile: /^[36]\d{7}$/, landline: /^1\d{7}$/,
          hint: 'Bahrain numbers are +973 then 8 digits.' },
        { cc: '968', iso: 'OM', name: 'Oman', trunk: '', nsn: [8],
          mobile: /^[79]\d{7}$/, landline: /^2\d{7}$/,
          hint: 'Oman numbers are +968 then 8 digits starting 7 or 9 (mobile) or 2 (landline).' },
        { cc: '20', iso: 'EG', name: 'Egypt', trunk: '0', nsn: [10],
          mobile: /^1[0125]\d{8}$/, landline: /^[23]\d{7,8}$/,
          hint: 'Egyptian mobiles are +20 then 10, 11, 12 or 15 and 8 more digits.' },
        // Length-only below this line: the sub-ranges are not encoded because my confidence in them
        // is not high enough to reject a real number on.
        { cc: '44', iso: 'GB', name: 'United Kingdom', trunk: '0', nsn: [9, 10], hint: '' },
        { cc: '1',  iso: 'US', name: 'US / Canada', trunk: '1', nsn: [10],
          mobile: /^[2-9]\d{2}[2-9]\d{6}$/, hint: 'US and Canada numbers are 10 digits.' },
        { cc: '91', iso: 'IN', name: 'India', trunk: '0', nsn: [10], mobile: /^[6-9]\d{9}$/, hint: '' },
        { cc: '92', iso: 'PK', name: 'Pakistan', trunk: '0', nsn: [10], hint: '' },
        { cc: '962', iso: 'JO', name: 'Jordan', trunk: '0', nsn: [9], hint: '' },
        { cc: '961', iso: 'LB', name: 'Lebanon', trunk: '0', nsn: [7, 8], hint: '' },
        { cc: '90', iso: 'TR', name: 'Türkiye', trunk: '0', nsn: [10], hint: '' },
        { cc: '49', iso: 'DE', name: 'Germany', trunk: '0', nsn: [10, 11], hint: '' },
        { cc: '33', iso: 'FR', name: 'France', trunk: '0', nsn: [9], hint: '' }
    ];

    // Every country, for the selector. Names from CLDR via Intl.DisplayNames rather than typed by
    // hand; dial codes cross-checked against the detailed PLANS above, which are the ones that
    // actually validate. Ordered: the studio's markets first, then alphabetical.
    // Format: [ISO 3166-1 alpha-2, dialling code, English name]
    var DIRECTORY = [
        ['US','1',"United States"],['AE','971',"United Arab Emirates"],['SA','966',"Saudi Arabia"],
        ['QA','974',"Qatar"],['CA','1',"Canada"],['KW','965',"Kuwait"],['BH','973',"Bahrain"],['OM','968',"Oman"],
        ['AF','93',"Afghanistan"],['AX','358',"Åland Islands"],['AL','355',"Albania"],['DZ','213',"Algeria"],
        ['AS','1',"American Samoa"],['AD','376',"Andorra"],['AO','244',"Angola"],['AI','1',"Anguilla"],
        ['AG','1',"Antigua & Barbuda"],['AR','54',"Argentina"],['AM','374',"Armenia"],['AW','297',"Aruba"],
        ['AU','61',"Australia"],['AT','43',"Austria"],['AZ','994',"Azerbaijan"],['BS','1',"Bahamas"],
        ['BD','880',"Bangladesh"],['BB','1',"Barbados"],['BY','375',"Belarus"],['BE','32',"Belgium"],
        ['BZ','501',"Belize"],['BJ','229',"Benin"],['BM','1',"Bermuda"],['BT','975',"Bhutan"],
        ['BO','591',"Bolivia"],['BA','387',"Bosnia & Herzegovina"],['BW','267',"Botswana"],['BR','55',"Brazil"],
        ['VG','1',"British Virgin Islands"],['BN','673',"Brunei"],['BG','359',"Bulgaria"],
        ['BF','226',"Burkina Faso"],['BI','257',"Burundi"],['KH','855',"Cambodia"],['CM','237',"Cameroon"],
        ['CV','238',"Cape Verde"],['KY','1',"Cayman Islands"],['CF','236',"Central African Republic"],
        ['TD','235',"Chad"],['CL','56',"Chile"],['CN','86',"China"],['CO','57',"Colombia"],['KM','269',"Comoros"],
        ['CG','242',"Congo - Brazzaville"],['CD','243',"Congo - Kinshasa"],['CK','682',"Cook Islands"],
        ['CR','506',"Costa Rica"],['CI','225',"Côte d’Ivoire"],['HR','385',"Croatia"],['CU','53',"Cuba"],
        ['CW','599',"Curaçao"],['CY','357',"Cyprus"],['CZ','420',"Czechia"],['DK','45',"Denmark"],
        ['DJ','253',"Djibouti"],['DM','1',"Dominica"],['DO','1',"Dominican Republic"],['EC','593',"Ecuador"],
        ['EG','20',"Egypt"],['SV','503',"El Salvador"],['GQ','240',"Equatorial Guinea"],['ER','291',"Eritrea"],
        ['EE','372',"Estonia"],['SZ','268',"Eswatini"],['ET','251',"Ethiopia"],['FK','500',"Falkland Islands"],
        ['FO','298',"Faroe Islands"],['FJ','679',"Fiji"],['FI','358',"Finland"],['FR','33',"France"],
        ['GF','594',"French Guiana"],['PF','689',"French Polynesia"],['GA','241',"Gabon"],['GM','220',"Gambia"],
        ['GE','995',"Georgia"],['DE','49',"Germany"],['GH','233',"Ghana"],['GI','350',"Gibraltar"],
        ['GR','30',"Greece"],['GL','299',"Greenland"],['GD','1',"Grenada"],['GU','1',"Guam"],
        ['GT','502',"Guatemala"],['GG','44',"Guernsey"],['GN','224',"Guinea"],['GW','245',"Guinea-Bissau"],
        ['GY','592',"Guyana"],['HT','509',"Haiti"],['HN','504',"Honduras"],['HK','852',"Hong Kong SAR China"],
        ['HU','36',"Hungary"],['IS','354',"Iceland"],['IN','91',"India"],['ID','62',"Indonesia"],['IR','98',"Iran"],
        ['IQ','964',"Iraq"],['IE','353',"Ireland"],['IM','44',"Isle of Man"],['IL','972',"Israel"],
        ['IT','39',"Italy"],['JM','1',"Jamaica"],['JP','81',"Japan"],['JE','44',"Jersey"],['JO','962',"Jordan"],
        ['KZ','7',"Kazakhstan"],['KE','254',"Kenya"],['KI','686',"Kiribati"],['KG','996',"Kyrgyzstan"],
        ['LA','856',"Laos"],['LV','371',"Latvia"],['LB','961',"Lebanon"],['LS','266',"Lesotho"],
        ['LR','231',"Liberia"],['LY','218',"Libya"],['LI','423',"Liechtenstein"],['LT','370',"Lithuania"],
        ['LU','352',"Luxembourg"],['MO','853',"Macao SAR China"],['MG','261',"Madagascar"],['MW','265',"Malawi"],
        ['MY','60',"Malaysia"],['MV','960',"Maldives"],['ML','223',"Mali"],['MT','356',"Malta"],
        ['MH','692',"Marshall Islands"],['MR','222',"Mauritania"],['MU','230',"Mauritius"],['MX','52',"Mexico"],
        ['FM','691',"Micronesia"],['MD','373',"Moldova"],['MC','377',"Monaco"],['MN','976',"Mongolia"],
        ['ME','382',"Montenegro"],['MS','1',"Montserrat"],['MA','212',"Morocco"],['MZ','258',"Mozambique"],
        ['MM','95',"Myanmar (Burma)"],['NA','264',"Namibia"],['NR','674',"Nauru"],['NP','977',"Nepal"],
        ['NL','31',"Netherlands"],['NC','687',"New Caledonia"],['NZ','64',"New Zealand"],['NI','505',"Nicaragua"],
        ['NE','227',"Niger"],['NG','234',"Nigeria"],['NU','683',"Niue"],['KP','850',"North Korea"],
        ['MK','389',"North Macedonia"],['MP','1',"Northern Mariana Islands"],['NO','47',"Norway"],
        ['PK','92',"Pakistan"],['PW','680',"Palau"],['PS','970',"Palestinian Territories"],['PA','507',"Panama"],
        ['PG','675',"Papua New Guinea"],['PY','595',"Paraguay"],['PE','51',"Peru"],['PH','63',"Philippines"],
        ['PL','48',"Poland"],['PT','351',"Portugal"],['PR','1',"Puerto Rico"],['RO','40',"Romania"],
        ['RU','7',"Russia"],['RW','250',"Rwanda"],['WS','685',"Samoa"],['SM','378',"San Marino"],
        ['ST','239',"São Tomé & Príncipe"],['SN','221',"Senegal"],['RS','381',"Serbia"],['SC','248',"Seychelles"],
        ['SL','232',"Sierra Leone"],['SG','65',"Singapore"],['SX','1',"Sint Maarten"],['SK','421',"Slovakia"],
        ['SI','386',"Slovenia"],['SB','677',"Solomon Islands"],['SO','252',"Somalia"],['ZA','27',"South Africa"],
        ['KR','82',"South Korea"],['SS','211',"South Sudan"],['ES','34',"Spain"],['LK','94',"Sri Lanka"],
        ['KN','1',"St. Kitts & Nevis"],['LC','1',"St. Lucia"],['VC','1',"St. Vincent & Grenadines"],
        ['SD','249',"Sudan"],['SR','597',"Suriname"],['SE','46',"Sweden"],['CH','41',"Switzerland"],
        ['SY','963',"Syria"],['TW','886',"Taiwan"],['TJ','992',"Tajikistan"],['TZ','255',"Tanzania"],
        ['TH','66',"Thailand"],['TL','670',"Timor-Leste"],['TG','228',"Togo"],['TK','690',"Tokelau"],
        ['TO','676',"Tonga"],['TT','1',"Trinidad & Tobago"],['TN','216',"Tunisia"],['TR','90',"Türkiye"],
        ['TM','993',"Turkmenistan"],['TC','1',"Turks & Caicos Islands"],['TV','688',"Tuvalu"],
        ['VI','1',"U.S. Virgin Islands"],['UG','256',"Uganda"],['UA','380',"Ukraine"],['GB','44',"United Kingdom"],
        ['UY','598',"Uruguay"],['UZ','998',"Uzbekistan"],['VU','678',"Vanuatu"],['VA','39',"Vatican City"],
        ['VE','58',"Venezuela"],['VN','84',"Vietnam"],['WF','681',"Wallis & Futuna"],['EH','212',"Western Sahara"],
        ['YE','967',"Yemen"],['ZM','260',"Zambia"],['ZW','263',"Zimbabwe"],
    ];
    var PRIORITY_COUNT = 8;   // how many entries at the top are the pinned market list

    var DIR_BY_ISO = {};
    for (var _i = 0; _i < DIRECTORY.length; _i++) DIR_BY_ISO[DIRECTORY[_i][0]] = DIRECTORY[_i];

    // Trunk prefix for a country with no detailed plan. Almost everywhere it is '0'; the exceptions
    // that matter to this studio (the Gulf states, which have none, and +1 which uses '1') all have
    // detailed plans already, so this default is safe for the long tail. Getting it wrong would turn
    // a local Irish 087… into +3530 87…, which is not a number.
    var GENERIC_TRUNK = '0';

    // Longest dialling code first, so +971 is never shadowed by +9 and +1 never by nothing.
    var BY_LENGTH = PLANS.slice().sort(function (a, b) { return b.cc.length - a.cc.length; });
    // Same idea across the full directory, for naming a country we do not validate in detail.
    var DIR_BY_LENGTH = DIRECTORY.slice().sort(function (a, b) { return b[1].length - a[1].length; });

    function dirForCode(d) {
        for (var i = 0; i < DIR_BY_LENGTH.length; i++) if (d.indexOf(DIR_BY_LENGTH[i][1]) === 0) return DIR_BY_LENGTH[i];
        return null;
    }
    /* Regional-indicator pair, e.g. AE -> the UAE flag.
       NOT RENDERED BY THE SELECTOR ANY MORE, and do not put it back without a platform check. Windows
       ships no flag glyphs, so it draws the letter pair instead: beside the ISO code every row read
       "AE AE +971", which looked like a rendering bug on the one screen every lead passes through.
       Kept on the public API because it is harmless and callers may want it in their own markup. */
    function flagOf(iso) {
        if (!/^[A-Z]{2}$/.test(iso)) return '';
        return String.fromCodePoint(0x1F1E6 + iso.charCodeAt(0) - 65, 0x1F1E6 + iso.charCodeAt(1) - 65);
    }

    function digitsOnly(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }

    /* parse(raw, defaultCC)
       defaultCC: dialling code assumed for a number typed in local form, e.g. '971'.
       Returns { ok, e164, plus, country, iso, kind, reason }
         e164  digits only, country code first, no '+'  -> what to hash for Meta/Google
         plus  '+' + e164                               -> what to show and to submit
         kind  'mobile' | 'landline' | 'unknown'
    */
    function parse(raw, defaultCC) {
        defaultCC = defaultCC || '971';
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { ok: false, reason: 'Please enter your phone number.', country: null };

        // A letter in a phone field is almost always a bot or a paste accident.
        if (/[a-z]/i.test(s)) return { ok: false, reason: 'Please enter digits only.', country: null };

        var hadPlus = s.charAt(0) === '+';
        var d = digitsOnly(s);
        if (!d) return { ok: false, reason: 'Please enter your phone number.', country: null };

        // "00" is the international prefix in most of the world and means the same as "+".
        if (!hadPlus && d.slice(0, 2) === '00') { d = d.slice(2); hadPlus = true; }

        if (!hadPlus) {
            var plan0 = find(defaultCC);
            // No detailed plan for the selected country — synthesise just enough of one to strip the
            // trunk prefix. Without this a local number from any of the ~210 countries the selector
            // now offers keeps its leading 0 and becomes an undialable +3530871234567.
            if (!plan0) {
                var dir0 = null;
                for (var di = 0; di < DIRECTORY.length; di++) if (DIRECTORY[di][1] === String(defaultCC)) { dir0 = DIRECTORY[di]; break; }
                if (dir0) plan0 = { cc: dir0[1], iso: dir0[0], name: dir0[2], trunk: GENERIC_TRUNK, nsn: [] };
            }
            // "971509027130" — the full dialling code typed without a +. Detect that BEFORE assuming
            // local form, or the code gets prepended twice and a perfectly good number is rejected
            // for being 12 digits long. Safe to test for: no UAE local number begins 971, and the
            // same holds for the other plans here.
            var alreadyIntl = plan0 && d.indexOf(defaultCC) === 0 &&
                              plan0.nsn.indexOf(d.length - defaultCC.length) !== -1;
            if (!alreadyIntl) {
                // Local form. A leading trunk 0 is dropped; anything else is assumed national.
                var nsn0 = d;
                if (plan0 && plan0.trunk && nsn0.charAt(0) === plan0.trunk) nsn0 = nsn0.slice(1);
                d = defaultCC + nsn0;
            }
        }

        var plan = null, nsn = null;
        for (var i = 0; i < BY_LENGTH.length; i++) {
            if (d.indexOf(BY_LENGTH[i].cc) === 0) { plan = BY_LENGTH[i]; nsn = d.slice(plan.cc.length); break; }
        }

        // THE most common real-world error: +971 0 50 ... — trunk zero left in after the code.
        if (plan && plan.trunk && nsn.charAt(0) === plan.trunk && plan.nsn.indexOf(nsn.length) === -1) {
            nsn = nsn.slice(1);
        }

        if (!plan) {
            // No DETAILED plan. E.164 caps the whole number at 15 digits. Accept rather than reject —
            // this studio takes work from more countries than are validated in detail above, and an
            // over-strict rule silently kills real leads.
            if (d.length < 8 || d.length > 15) {
                return { ok: false, reason: 'That does not look like a valid international number.', country: null };
            }
            // The directory can still NAME it even though it cannot validate it, so the lead records
            // "Ireland (+353)" rather than "unknown".
            var dirHit = dirForCode(d);
            return { ok: true, e164: d, plus: '+' + d,
                     country: dirHit ? dirHit[2] : 'unknown', iso: dirHit ? dirHit[0] : null,
                     kind: 'unknown', reason: '' };
        }

        if (plan.nsn.indexOf(nsn.length) === -1) {
            var want = plan.nsn.length === 1 ? plan.nsn[0] + ' digits' : plan.nsn.join(' or ') + ' digits';
            return {
                ok: false, country: plan.name, iso: plan.iso,
                reason: 'A ' + plan.name + ' number needs ' + want + ' after +' + plan.cc +
                        ' — you entered ' + nsn.length + '.' + (plan.hint ? ' ' + plan.hint : '')
            };
        }

        // Toll-free and premium ranges are not a person you can call back.
        if (/^80\d/.test(nsn) || /^90\d/.test(nsn) && plan.cc === '971') {
            return { ok: false, country: plan.name, iso: plan.iso,
                     reason: 'Please give a mobile or landline number we can reach you on, not a service number.' };
        }

        var kind = 'unknown';
        if (plan.mobile && plan.mobile.test(nsn)) kind = 'mobile';
        else if (plan.landline && plan.landline.test(nsn)) kind = 'landline';
        else if (plan.mobile || plan.landline) {
            // The length is right but the leading digits match no known range for this country.
            return { ok: false, country: plan.name, iso: plan.iso,
                     reason: 'That is not a recognised ' + plan.name + ' number.' + (plan.hint ? ' ' + plan.hint : '') };
        }

        return { ok: true, e164: plan.cc + nsn, plus: '+' + plan.cc + nsn,
                 country: plan.name, iso: plan.iso, kind: kind, reason: '' };
    }

    function find(cc) {
        for (var i = 0; i < PLANS.length; i++) if (PLANS[i].cc === String(cc)) return PLANS[i];
        return null;
    }

    /* normalise(raw, defaultCC) -> E.164 digits with no '+', or the bare digits if unparseable.
       This is what gets hashed for Meta CAPI and Google enhanced conversions. It must NEVER throw
       and must never return empty for a non-empty input, because a tracking call is not a place to
       lose data over a formatting disagreement. */
    function normalise(raw, defaultCC) {
        try {
            var r = parse(raw, defaultCC);
            if (r.ok && r.e164) return r.e164;
        } catch (e) {}
        return digitsOnly(raw);
    }

    /* ── country selector ────────────────────────────────────────────────────────────────────────
       Built here rather than pulled in from intl-tel-input: the dialling data this needs is already
       above, the widget has to inherit the site's own styling rather than look bolted on, and a
       ~90KB dependency for a dropdown is not a trade worth making.

       mountSelector(input) wraps an existing <input type="tel"> and returns
         { iso(), dial(), cc(), set(iso), destroy() }
       It also writes two hidden inputs next to the field, so a real <form> posting FormData picks up
       the country with no extra JavaScript at the call site. */
    function mountSelector(input, opts) {
        if (!input || input.__wtcc) return input && input.__wtcc;
        opts = opts || {};
        var startIso = (opts.iso || 'AE').toUpperCase();
        if (!DIR_BY_ISO[startIso]) startIso = 'AE';

        var wrap = document.createElement('div');
        wrap.className = 'wt-cc-wrap';
        // The host is flagged so CSS can react to the field having been rewrapped. The floating-label
        // fields on the homepage and /contact match with `input:not(:placeholder-shown) ~ label`, and
        // moving the input inside .wt-cc-wrap makes it stop being the label's sibling — so the label
        // silently stayed in its resting position, on top of the selector. The class lets those pages
        // pin the label to its floated state, which is correct anyway: with a country button always
        // showing "AE +971" the field is never visually empty.
        var host = input.parentNode;
        host.classList.add('wt-cc-host');
        host.insertBefore(wrap, input);

        /* Requested shape: the closed control shows the dial code and nothing else — "+971 ⌄" — and the
           panel carries a search box above rows of "AE +971". A native <select> cannot hold a search
           box, and it cannot show different text closed than in its list, so this is hand-built.
           The two faults it shipped with before are addressed structurally, not by tweaking:
             - the panel once rendered as a search box with NOTHING under it. The list is now
               `flex: 1 1 auto` with a `min-height`, inside a panel with a DEFINITE height rather than
               only a max-height, so a zero-height list is not a state the layout can reach.
             - it did not always close. There is now exactly one close path used by every route out
               (selection, outside click, Escape, Tab away), instead of several partial ones.          */
        var cc = document.createElement('div');
        cc.className = 'wt-cc';
        wrap.appendChild(cc);
        wrap.appendChild(input);                       // the phone field sits beside the selector

        var btn = document.createElement('button');
        btn.type = 'button';                           // never submits the form it lives in
        btn.className = 'wt-cc-btn interactable';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Country dialling code');
        cc.appendChild(btn);

        var pop = document.createElement('div');
        pop.className = 'wt-cc-pop';
        pop.hidden = true;
        cc.appendChild(pop);

        var search = document.createElement('input');
        search.type = 'text';
        search.className = 'wt-cc-search';
        search.placeholder = 'Search country or code';
        search.setAttribute('aria-label', 'Search country or dialling code');
        search.autocomplete = 'off';
        pop.appendChild(search);

        var list = document.createElement('div');
        list.className = 'wt-cc-list';
        list.setAttribute('role', 'listbox');
        pop.appendChild(list);

        var hidIso = document.createElement('input');
        hidIso.type = 'hidden'; hidIso.name = 'phone_country_iso';
        var hidDial = document.createElement('input');
        hidDial.type = 'hidden'; hidDial.name = 'phone_dial_code';
        var hidRaw = document.createElement('input');
        hidRaw.type = 'hidden'; hidRaw.name = 'phone_raw';
        // The display name travels too, purely so the notification email can say "United Arab
        // Emirates (+971)" without a second copy of the 228-country table existing in PHP. The ISO
        // code is the authoritative value; this is a label, and the server sanitises it as one.
        var hidName = document.createElement('input');
        hidName.type = 'hidden'; hidName.name = 'phone_country_name';
        wrap.appendChild(hidIso); wrap.appendChild(hidDial); wrap.appendChild(hidRaw); wrap.appendChild(hidName);

        var current = startIso;

        /* The closed control is the dial code alone. The country name is deliberately not here: at
           "United Arab Emirates" width it swallowed the field, which is what the owner struck out. */
        function paint() {
            var e = DIR_BY_ISO[current];
            btn.textContent = '';
            var dial = document.createElement('span');
            dial.className = 'wt-cc-dial';
            dial.textContent = '+' + e[1];
            btn.appendChild(dial);
            btn.insertAdjacentHTML('beforeend',
                '<svg class="wt-cc-caret" width="10" height="7" viewBox="0 0 10 7" fill="none" aria-hidden="true">'
              + '<path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
            btn.title = e[2] + ' (+' + e[1] + ')';     // full name on hover, since the label is compact
            hidIso.value = e[0];
            hidDial.value = '+' + e[1];
            hidName.value = e[2];
        }

        /* What people actually type. "UAE" appears nowhere in "United Arab Emirates" and "KSA" nowhere
           in "Saudi Arabia", so searching for either found nothing — and those are the two markets this
           form exists to serve. Lowercase, space-separated, matched as a substring. Keep it short: this
           is for names a visitor would reasonably try, not a synonym dictionary. */
        var ALIASES = {
            AE: 'uae emirates dubai abu dhabi sharjah',
            SA: 'ksa saudi kingdom riyadh jeddah',
            US: 'usa america united states',
            GB: 'uk britain british england scotland wales',
            QA: 'qatar doha',
            KW: 'kuwait',
            BH: 'bahrain manama',
            OM: 'oman muscat',
            CA: 'canada',
            IN: 'india bharat',
            PK: 'pakistan',
            EG: 'egypt cairo',
            JO: 'jordan amman',
            LB: 'lebanon beirut',
            TR: 'turkey turkiye',
            NL: 'holland netherlands dutch',
            DE: 'germany deutschland',
            KR: 'south korea',
            KP: 'north korea',
            RU: 'russia',
            CN: 'china',
            AU: 'australia',
            SG: 'singapore',
            HK: 'hong kong',
            CH: 'switzerland swiss',
            CZ: 'czech republic czechia',
            IR: 'iran',
            SY: 'syria',
            VN: 'vietnam',
            LA: 'laos',
            CI: 'ivory coast cote divoire',
            CD: 'congo drc',
            VA: 'vatican'
        };

        /* ROWS ARE BUILT ONCE, AT MOUNT — the same moment as the search box. This is the fix for a
           panel that twice rendered as a search box above a blank area. It was never reproducible here
           (228 rows, opacity 1, headful, on production), so it is removed by construction instead of by
           diagnosis: the list is populated when the search box is, and the search box always rendered.
           Filtering hides rows, it never clears and rebuilds them, so there is no longer a window in
           which the list legitimately contains nothing. Do not move this back into open().            */
        var rowByIso = {}, sepEl = null, noneEl = null;

        function buildRows() {
            list.textContent = '';
            rowByIso = {};
            for (var i = 0; i < DIRECTORY.length; i++) {
                var e = DIRECTORY[i];
                if (i === PRIORITY_COUNT) {        // divider under the pinned markets
                    sepEl = document.createElement('div');
                    sepEl.className = 'wt-cc-sep';
                    sepEl.setAttribute('aria-hidden', 'true');
                    list.appendChild(sepEl);
                }
                var row = document.createElement('div');
                row.className = 'wt-cc-opt';
                row.setAttribute('role', 'option');
                row.setAttribute('tabindex', '-1');
                row.setAttribute('data-iso', e[0]);
                row.title = String(e[2] || '');    // full name on hover; the row itself stays compact
                var iso = document.createElement('span');
                iso.className = 'wt-cc-iso';
                iso.textContent = e[0];
                var dial = document.createElement('span');
                dial.className = 'wt-cc-dial';
                dial.textContent = '+' + e[1];
                row.appendChild(iso); row.appendChild(dial);
                list.appendChild(row);
                rowByIso[e[0]] = row;
            }
            noneEl = document.createElement('div');
            noneEl.className = 'wt-cc-none';
            noneEl.textContent = 'No match';
            noneEl.hidden = true;
            list.appendChild(noneEl);
        }

        /* Matches name, ISO or dial code, so typing "saudi" finds SA +966 even though the row shows only
           the code. Every field is String()-coerced: a malformed directory entry must degrade to "does
           not match", never throw — a throw here would leave the list wiped mid-filter. */
        function filterRows(q) {
            q = String(q == null ? '' : q).trim().toLowerCase().replace(/^\+/, '');
            var shown = 0;
            for (var i = 0; i < DIRECTORY.length; i++) {
                var e = DIRECTORY[i], row = rowByIso[e[0]];
                if (!row) continue;
                var hit = !q
                       || String(e[2] || '').toLowerCase().indexOf(q) !== -1
                       || String(e[0] || '').toLowerCase().indexOf(q) === 0
                       || String(e[1] || '').indexOf(q) === 0
                       || (ALIASES[e[0]] || '').indexOf(q) !== -1;
                row.hidden = !hit;
                if (hit) shown++;
            }
            if (sepEl)  sepEl.hidden  = !!q;   // the pinned/alphabetical split is meaningless once typing
            if (noneEl) noneEl.hidden = shown > 0;
            list.scrollTop = 0;                // otherwise the first match can be scrolled out of view
            return shown;
        }

        function markSelected() {
            for (var iso in rowByIso) {
                if (!Object.prototype.hasOwnProperty.call(rowByIso, iso)) continue;
                if (iso === current) rowByIso[iso].setAttribute('aria-selected', 'true');
                else rowByIso[iso].removeAttribute('aria-selected');
            }
        }

        function open() {
            // Self-heal: if anything ever empties the list, repopulate rather than open onto a blank box.
            if (!list.querySelector('.wt-cc-opt')) buildRows();
            search.value = '';
            filterRows('');
            markSelected();
            pop.hidden = false;
            cc.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');
            var sel = rowByIso[current];
            if (sel) sel.scrollIntoView({ block: 'nearest' });
            search.focus();
        }
        // The ONLY close path. Every route out of the panel calls this one function — the previous
        // version had the logic spread across handlers and one of them did not fire.
        function close() {
            if (pop.hidden) return;
            pop.hidden = true;
            cc.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
        function choose(iso) {
            if (!DIR_BY_ISO[iso]) return;
            current = iso;
            paint();
            close();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            try { input.dispatchEvent(new CustomEvent('wt-cc-change', { bubbles: true, detail: { iso: iso, dial: '+' + DIR_BY_ISO[iso][1] } })); } catch (_) {}
            input.focus();
        }

        btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); pop.hidden ? open() : close(); });
        search.addEventListener('input', function () { filterRows(search.value); });
        // mousedown, not click: the row must win before the document handler or a focus change can
        // move the ground under it. This is the path that used to leave the panel open.
        list.addEventListener('mousedown', function (e) {
            var t = e.target, row = null;
            while (t && t !== list) { if (t.classList && t.classList.contains('wt-cc-opt')) { row = t; break; } t = t.parentNode; }
            if (!row) return;
            e.preventDefault();
            choose(row.getAttribute('data-iso'));
        });
        search.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { close(); btn.focus(); }
            // :not([hidden]) matters now that filtering hides rows instead of removing them — without
            // it, Enter would pick the first row in the directory rather than the first match.
            if (e.key === 'Enter')  { e.preventDefault(); var f = list.querySelector('.wt-cc-opt:not([hidden])'); if (f) choose(f.getAttribute('data-iso')); }
        });
        /* CAPTURE PHASE, and focusin as well as click. The service and budget dropdowns on these forms
           call stopPropagation() on their own triggers, so a bubbling document listener never heard
           about them and this panel stayed open behind an open service list. Capture runs before any
           handler can stop the event, so it cannot be suppressed. focusin covers tabbing to another
           field, which produces no outside click at all. mousedown closes before the other dropdown
           even paints, so the two are never open together for a frame. */
        function closeIfOutside(e) { if (!cc.contains(e.target)) close(); }
        document.addEventListener('mousedown', closeIfOutside, true);
        document.addEventListener('click', closeIfOutside, true);
        document.addEventListener('focusin', closeIfOutside, true);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

        // Typing a full international number should move the selector rather than be rejected for
        // disagreeing with it. Pasting "+966 5…" while UAE is selected switches to Saudi Arabia.
        input.addEventListener('input', function () {
            hidRaw.value = input.value;
            var t = input.value.trim();
            if (t.charAt(0) !== '+' && t.slice(0, 2) !== '00') return;
            var d = t.replace(/\D/g, '').replace(/^00/, '');
            var hit = dirForCode(d);
            if (hit && hit[0] !== current && d.length > hit[1].length) { current = hit[0]; paint(); }
        });

        // Rows exist from mount, not from first open. This is the whole point of the change above:
        // the search box always rendered, so building the rows at the same instant means they do too.
        buildRows();
        filterRows('');
        markSelected();
        paint();
        var api = {
            iso:  function () { return current; },
            cc:   function () { return DIR_BY_ISO[current][1]; },
            dial: function () { return '+' + DIR_BY_ISO[current][1]; },
            name: function () { return DIR_BY_ISO[current][2]; },
            set:  function (iso) { choose(String(iso || '').toUpperCase()); },
            raw:  function () { return input.value; }
        };
        input.__wtcc = api;
        return api;
    }

    window.wtPhone = {
        parse: parse, normalise: normalise, plans: PLANS,
        countries: function () { return DIRECTORY.slice(); },
        mountSelector: mountSelector,
        flagOf: flagOf
    };
})();
