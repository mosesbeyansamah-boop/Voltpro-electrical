/* =====================================================================
   VOLTPRO - script.js - FIXED FOR GITHUB PAGES
   Contact form now uses FormSubmit.co (no server needed)
   ===================================================================== */
(function () {
    "use strict";

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---------- Footer year ---------- */
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();

    /* ---------- Mobile menu ---------- */
    const toggle = $("#menuToggle");
    const links = $("#navLinks");
    const desktop = window.matchMedia("(min-width: 960px)");

    function setMenu(open) {
        if (!toggle || !links) return;
        links.classList.toggle("open", open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
        toggle.textContent = open ? "✕" : "☰";
    }

    if (toggle && links) {
        toggle.addEventListener("click", () => setMenu(!links.classList.contains("open")));
        $$("a", links).forEach(a => a.addEventListener("click", () => setMenu(false)));
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && links.classList.contains("open")) { setMenu(false); toggle.focus(); }
        });
        document.addEventListener("click", e => {
            if (links.classList.contains("open") && !links.contains(e.target) && !toggle.contains(e.target)) setMenu(false);
        });
        desktop.addEventListener("change", () => setMenu(false));
    }

    /* ---------- Header shadow, back-to-top, active link ---------- */
    const header = $(".header");
    const backToTop = $("#backToTop");
    const sections = $$("main section[id]");
    const navAnchors = $$("#navLinks a");

    function onScroll() {
        const y = window.scrollY;
        if (header) header.classList.toggle("scrolled", y > 8);
        if (backToTop) backToTop.classList.toggle("show", y > 600);

        let current = "";
        sections.forEach(s => { if (y + 140 >= s.offsetTop) current = s.id; });
        navAnchors.forEach(a => {
            if (a.classList.contains("nav-contact")) return;
            a.classList.toggle("active", a.getAttribute("href") === "#" + current);
        });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (backToTop) {
        backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }));
    }

    /* ---------- Scroll reveal animation ---------- */
    const targets = $$(".highlight-grid > div, .about-image, .about-content, .section-heading, .service-card, .why-grid > div:first-child, .why-item, .project-card, .project-note, .cta-content, .contact-item, .contact-form");
    targets.forEach((el, i) => {
        el.classList.add("reveal");
        el.style.setProperty("--delay", (i % 3) * 0.08 + "s");
    });

    if ("IntersectionObserver" in window && !reduceMotion) {
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) { en.target.classList.add("visible"); io.unobserve(en.target); }
            });
        }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
        targets.forEach(el => io.observe(el));
    } else {
        targets.forEach(el => el.classList.add("visible"));
    }
})();

/* ===== Upgrade: clicking "Request this service" pre-selects it in the form ===== */
(function () {
    "use strict";
    var select = document.getElementById("service");
    if (!select) return;
    document.querySelectorAll("a[data-service]").forEach(function (link) {
        link.addEventListener("click", function () {
            select.value = link.getAttribute("data-service");
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
    });
})();
