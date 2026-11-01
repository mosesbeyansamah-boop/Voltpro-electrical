/* =====================================================================
   VOLTPRO - script.js
   FRONTEND: mobile menu, sticky-header shadow, active menu link, scroll
   animations, back-to-top button and footer year.
   BACKEND CONNECTION: the contact form is sent to the server (server.js)
   at /api/contact - see the last section of this file.
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

/* =====================================================================
   CONTACT FORM -> BACKEND
   Sends the form as JSON to POST /api/contact (handled by server.js).
   ===================================================================== */
(function () {
    "use strict";

    const form = document.getElementById("contactForm");
    const statusBox = document.getElementById("formStatus");
    if (!form) return;

    // Hidden spam-trap field. Real visitors never see it; bots fill it in.
    const trap = document.createElement("input");
    trap.type = "text";
    trap.name = "website";
    trap.tabIndex = -1;
    trap.autocomplete = "off";
    trap.setAttribute("aria-hidden", "true");
    trap.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;";
    form.appendChild(trap);

    function show(text, ok) {
        if (!statusBox) return;
        statusBox.textContent = text;
        statusBox.style.color = ok ? "#137a4b" : "#b42318";
        statusBox.style.fontWeight = "600";
    }

    // "document" + capture phase = runs before any other submit code on the page.
    document.addEventListener("submit", async function (e) {
        if (e.target !== form) return;
        e.preventDefault();
        e.stopImmediatePropagation();

        const button = form.querySelector("button[type=submit]");
        const original = button ? button.textContent : "";

        const data = {
            name: form.elements.name.value,
            email: form.elements.email.value,
            service: form.elements.service.value,
            message: form.elements.message.value,
            website: trap.value,
        };

        if (button) { button.disabled = true; button.textContent = "Sending..."; }
        show("Sending your message...", true);

        try {
            const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            const result = await res.json().catch(() => ({}));

            if (res.ok && result.ok) {
                form.reset();
                show(result.message || "Thank you! Your message has been received.", true);
            } else if (res.status === 400 && result.fields) {
                show(Object.values(result.fields).join(" "), false);
            } else {
                show(result.error || "Sorry, your message could not be sent. Please try again.", false);
            }
        } catch (err) {
            show("Cannot reach the server. Please check your connection or contact us by phone or email.", false);
        } finally {
            if (button) { button.disabled = false; button.textContent = original; }
        }
    }, true);
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