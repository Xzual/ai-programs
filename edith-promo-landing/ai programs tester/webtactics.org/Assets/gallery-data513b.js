/*
  Gallery project-data contract
  -----------------------------
  This is the gallery's single source of truth. Array order is display order. Each record supplies
  an artwork filename slug, category, title, description, and optional live URL. The final record is
  the centered Web Tactics hero; all earlier records are divided between the corridor's two walls.

  `acc` is the artwork's precomputed accent colour: the raw averaged sRGB triplet that drives that
  painting's halo, spotlight tint and frame uAccent. It used to be derived at runtime by drawing the
  image to a 2D canvas and calling getImageData(), which is a synchronous GPU->CPU readback — on a
  page that keeps the GPU saturated each call blocked for most of a frame, and because texture
  streaming reloads artwork as the camera moves it ran up to seven times per piece. Measured at 92%
  of all main-thread time during navigation. The value is a property of the image file and never
  changes, so it is baked here instead.

  Generated in real Chrome from the full-resolution file, using the same crop and the same
  midtone/saturation filter the runtime sampler used, so the numbers are what the browser itself
  produced. Do NOT hand-edit these. When adding or replacing artwork, re-bake it; a record with no
  `acc` still works — Gallery.html falls back to sampling that one piece at runtime.
*/
window.WT_WORKS = [
  { src: "brand-booster-event-sponsorship", tag: "Sponsor · Event & Web", title: "Brand Booster", desc: "As a sponsor of Brand Booster, we helped launch their debut event — Instagram, invitations and event branding — then built their website.", acc: [109, 74, 85] },
  { src: "artistic-business-solutions-website", tag: "Website", title: "Artistic Business Solutions", desc: "An immersive digital flagship — smart solutions, events and futuristic environments, engineered for presence.", acc: [81, 70, 98] },
  { src: "al-fidaa-contracting-profile", tag: "Company Profile", title: "Al Fidaa", desc: "A commanding profile for a UAE contracting house — villas, pools and landscapes rendered with authority.", acc: [105, 104, 104] },
  { src: "3esh-brand-guidelines", tag: "Brand Guidelines", title: "3esh", desc: "Heritage-rooted identity for an Emirati apparel house — cultural narrative reimagined as modern streetwear.", acc: [168, 146, 122] },
  { src: "black-crown-label-lookbook", tag: "Lookbook", title: "Black Crown Label", desc: "An editorial lookbook for an exclusive label — couture framed with restraint and drama.", acc: [109, 82, 71] },
  { src: "axe-capital-website", tag: "Website", title: "Axe Capital", desc: "A composed corporate presence for finance and investment — poised, precise, trust by design.", acc: [102, 94, 104] },
  { src: "artistic-business-solutions-brand-profile", tag: "Brand Profile", title: "Artistic Business Solutions", desc: "A future-facing profile for an immersive-tech studio — LED, XR, VR and live experiences, unified.", acc: [67, 55, 99] },
  { src: "art-coordinate-brand-guidelines", tag: "Brand Guidelines", title: "Art Coordinate", desc: "A refined identity system for a creative platform — structured, gallery-clean and quietly confident.", acc: [129, 119, 108] },
  { src: "bothina", tag: "Lookbook", title: "Bothina", desc: "A softly feminine fashion story — clean lines, quiet luxury and considered mood.", acc: [136, 120, 110] },
  { src: "bite-bloom-website", tag: "Website", title: "Bite Bloom", desc: "A fresh, appetite-forward digital experience — colour, clarity and craving in equal measure.", acc: [100, 86, 101] },
  { src: "crown-circle-event-showcase", tag: "Event Showcase", title: "Crown Circle", desc: "An art-meets-fashion showcase capturing the Crown Circle — exclusive, editorial, unmistakably elevated.", acc: [125, 81, 72] },
  { src: "lenjawi-website", tag: "Website", title: "Lenjawi", desc: "A full rebuild for a Dubai property developer — landmark towers and residences staged with quiet, luxurious authority.", acc: [192, 172, 147] },
  { src: "brand-booster-website", tag: "Website", title: "Brand Booster", desc: "A bold event destination — speakers, sponsorships and the full Brand Booster experience, staged online.", acc: [96, 84, 103] },
  { src: "drape-wear-lookbook", tag: "Lookbook", title: "Drape Wear", desc: "An elegant lookbook for Drape Wear — collections styled in editorial, product-first frames.", acc: [139, 117, 100] },
  { src: "crown-circle-profile", tag: "Company Profile", title: "Crown Circle", desc: "A cultural-luxury profile positioning Crown Circle as a rarefied fashion experience.", acc: [110, 89, 71] },
  { src: "doha-series-brand-guidelines", tag: "Brand Guidelines", title: "Doha Series", desc: "A crisp corporate identity system carrying the poise of Doha's premium business world.", acc: [88, 83, 88] },
  { src: "designers-hub-website", tag: "Website", title: "Designers Hub", desc: "A gallery-style platform for a designer ecosystem — curated, modern and effortless to browse.", acc: [98, 88, 114] },
  { src: "hana-brand", tag: "Brand & Packaging", title: "Hana", desc: "A luxury fashion house brought to life through premium packaging and a bold feminine signature.", acc: [162, 143, 109] },
  { src: "designers-hub-profile", tag: "Company Profile", title: "Designers Hub", desc: "A profile for a creative community — design, opportunity and belonging, presented with polish.", acc: [136, 112, 89] },
  { src: "fleur-de-luxe-identity-and-guidelines", tag: "Identity & Guidelines", title: "Fleur De Luxe", desc: "A soft-luxury identity for a feminine lifestyle house — colour, type and packaging in harmony.", acc: [144, 119, 105] },
  { src: "drape-wear-website", tag: "Website", title: "Drape Wear", desc: "A refined e-commerce flagship — elegant fashion, clear product storytelling, luxury checkout.", acc: [103, 91, 117] },
  { src: "ninth-lookbook", tag: "Lookbook", title: "Ninth", desc: "A playful, colour-led lookbook — collections styled with personality and pace.", acc: [141, 128, 129] },
  { src: "kahramana-profile", tag: "Company Profile", title: "Kahramana", desc: "A profile built on elegant storytelling — fashion and craft presented with refined restraint.", acc: [107, 87, 76] },
  { src: "gulf-series-brand-guidelines", tag: "Brand Guidelines", title: "Gulf Series", desc: "A warm regional identity system — Gulf heritage and business elegance refined into one language.", acc: [143, 102, 75] },
  { src: "freebird-fashion-website", tag: "Website", title: "Freebird", desc: "A clean fashion destination — collections and lifestyle imagery framed with a premium calm.", acc: [89, 76, 107] },
  { src: "nasco-brand-profile-and-branding", tag: "Brand Profile", title: "NASCO", desc: "A complete brand system — profile, identity and corporate presence, unified end to end.", acc: [62, 80, 99] },
  { src: "istarahat-ae-website", tag: "Website", title: "Istarahat.ae", desc: "A modern hospitality platform for UAE rest houses — discovery made clean and effortless.", acc: [74, 75, 95] },
  { src: "hoyam-brand-guidelines", tag: "Brand Guidelines", title: "Hoyam", desc: "A dark-luxury guideline system — refined stationery and identity, styled for prestige.", acc: [180, 157, 110] },
  { src: "ornina-lookbook", tag: "Lookbook", title: "Ornina", desc: "A serene feminine lookbook — calm palettes and product-first storytelling, beautifully paced.", acc: [140, 110, 106] },
  { src: "new-world-technologies-website", tag: "Website", title: "New World Technologies", desc: "A premium tech flagship presenting future-focused innovation and digital transformation.", acc: [71, 66, 91] },
  { src: "parametric-design-company-profile", tag: "Company Profile", title: "Parametric Design", desc: "A sleek, architectural profile for a design house — dark, precise and quietly powerful.", acc: [80, 113, 113] },
  { src: "ifimes-brand-guidelines", tag: "Brand Guidelines", title: "IFIMES", desc: "An institutional identity built for clarity and trust — measured, credible, quietly authoritative.", acc: [69, 74, 90] },
  { src: "saba-fashion-lookbook", tag: "Lookbook", title: "Saba", desc: "A refined fashion lookbook — apparel framed in editorial layouts with premium styling.", acc: [100, 82, 66] },
  { src: "noor-al-khloud-website", tag: "Website", title: "Noor Al Khloud", desc: "A boutique fashion destination — collections presented as an elegant online atelier.", acc: [70, 68, 84] },
  { src: "we-grow-together-business-plan-and-sponsorship", tag: "Business Plan", title: "We Grow Together", desc: "A growth and sponsorship narrative — partnership and opportunity, presented to persuade.", acc: [60, 50, 50] },
  { src: "la-plume-brand-guidelines", tag: "Brand Guidelines", title: "La Plume", desc: "A delicate identity system — luxury stationery and feminine typography, composed with grace.", acc: [146, 125, 107] },
  { src: "rosa-couture-website", tag: "Website", title: "Rosa Couture", desc: "A couture digital gallery — elegant pieces presented with the hush of a private showing.", acc: [78, 66, 87] },
  { src: "scycle-lookbook", tag: "Lookbook", title: "Scycle", desc: "A clean lookbook built on consistency — product, styling and rhythm in premium balance.", acc: [115, 102, 103] },
  { src: "yasser-and-mayasa-company-profile", tag: "Company Profile", title: "Yasser & Mayasa", desc: "A polished company profile — brand story, services and identity, told with quiet assurance.", acc: [136, 115, 97] },
  { src: "new-world-technologies-brand", tag: "Brand Identity", title: "New World Technologies", desc: "A futuristic identity system pairing premium visuals with immersive digital direction.", acc: [87, 51, 108] },
  { src: "selas-official-website", tag: "Website", title: "Selas", desc: "A luxury fashion flagship — premium product showcasing and an elegant shopping experience.", acc: [107, 91, 102] },
  { src: "taftah-lookbook", tag: "Lookbook", title: "Taftah", desc: "A delicate lookbook in soft luxury — feminine visuals and clean editorial framing.", acc: [155, 135, 119] },
  { src: "zada-company-profile", tag: "Company Profile", title: "Zada", desc: "A premium profile — elegant visuals and structured sections, refined to the last detail.", acc: [170, 131, 109] },
  { src: "sada-brand-guidelines", tag: "Brand Guidelines", title: "Sada", desc: "A minimal identity system — soft colour, considered packaging and quiet, precise applications.", acc: [182, 156, 135] },
  { src: "timeline-travel-website-and-profile", tag: "Website & Profile", title: "Timeline Travel", desc: "A travel brand across web and print — destinations and services styled for polished wanderlust.", acc: [127, 126, 120] },
  { src: "villaamoon-lookbook", tag: "Lookbook", title: "Villaamoon", desc: "A luxury lookbook in deep tones — elegant pieces framed with refined, low-lit drama.", acc: [125, 102, 94] },
  { src: "zumra-group", tag: "Group Profile", title: "Zumra Group", desc: "A group identity uniting multiple ventures under one confident, premium presence.", acc: [75, 68, 90] },
  { src: "teen-art-awards-brand-guidelines", tag: "Brand Guidelines", title: "Teen Art Awards", desc: "A bold, youth-forward identity for an awards platform — creativity and energy, systemised.", acc: [86, 72, 54] },
  { src: "zozo-kahramana-website", tag: "Website", title: "Zozo Kahramana", desc: "A luxury fashion destination — brand and collections staged in an immersive 3D showcase.", acc: [88, 78, 104] },
  { src: "lpset-company-profile", tag: "Company Profile", title: "LPSET", desc: "A corporate profile presenting services and positioning with professional, understated confidence.", acc: [68, 76, 96] },
  { src: "web-tactics-signature-immersive-website", tag: "Our Signature Website", title: "Web Tactics", desc: "Our own signature — a 3D immersive web experience, and the studio behind every project in this gallery.", acc: [70, 61, 86] }
];
