(function () {
    'use strict';

    function closeDropdown() {
        document.querySelectorAll('.nav-dropdown.open').forEach(function (el) {
            el.classList.remove('open');
            var btn = el.querySelector('.nav-dropdown-toggle');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        });
    }

    function closeMobile() {
        var hm = document.querySelector('.hamburger');
        var nm = document.querySelector('.nav-menu');
        if (hm) hm.classList.remove('active');
        if (nm) nm.classList.remove('active');
        closeDropdown();
    }

    function bindExplorerNav() {
        var hamburger = document.querySelector('.hamburger');
        var navMenu = document.querySelector('.nav-menu');
        if (hamburger && navMenu && hamburger.parentNode) {
            var fresh = hamburger.cloneNode(true);
            hamburger.parentNode.replaceChild(fresh, hamburger);
            fresh.addEventListener('click', function () {
                fresh.classList.toggle('active');
                navMenu.classList.toggle('active');
            });
        }

        document.querySelectorAll('.nav-dropdown-toggle').forEach(function (btn) {
            var next = btn.cloneNode(true);
            btn.parentNode.replaceChild(next, btn);
            next.addEventListener('click', function (e) {
                e.stopPropagation();
                var li = next.closest('.nav-dropdown');
                if (!li) return;
                var open = !li.classList.contains('open');
                closeDropdown();
                if (open) {
                    li.classList.add('open');
                    next.setAttribute('aria-expanded', 'true');
                }
            });
        });

        if (!window._explorerNavDocBound) {
            window._explorerNavDocBound = true;
            document.addEventListener('click', function (e) {
                if (!e.target.closest || !e.target.closest('.nav-dropdown')) closeDropdown();
            });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeMobile();
            });
        }

        document.querySelectorAll('.nav-dropdown-panel a.nav-link').forEach(function (a) {
            a.addEventListener('click', function () { closeMobile(); });
        });
    }

    window.bindExplorerNav = bindExplorerNav;
    window.closeExplorerNav = closeMobile;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindExplorerNav);
    } else {
        bindExplorerNav();
    }
})();
