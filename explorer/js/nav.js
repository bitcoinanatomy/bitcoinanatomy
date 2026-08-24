(function () {
    'use strict';

    function syncNavDuck(open) {
        if (typeof window.ExplorerAudio === 'undefined') return;
        if (open) {
            ExplorerAudio.setDuck(true);
            return;
        }
        var ex = window.__explorer;
        if (ex && ex.montageActive && ex.montageMusicEnabled) return;
        ExplorerAudio.setDuck(false);
    }

    function closeDropdown() {
        var closing = false;
        document.querySelectorAll('.nav-dropdown.open').forEach(function (el) {
            closing = true;
            el.classList.remove('open');
            var btn = el.querySelector('.nav-dropdown-toggle');
            if (btn) btn.setAttribute('aria-expanded', 'false');
        });
        if (closing) syncNavDuck(false);
    }

    function bindExplorerNav() {
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
                    syncNavDuck(true);
                    if (typeof window.ExplorerAudio !== 'undefined') {
                        ExplorerAudio.unlock();
                        ExplorerAudio.play('ui-menu');
                    }
                }
            });
        });

        if (!window._explorerNavDocBound) {
            window._explorerNavDocBound = true;
            document.addEventListener('click', function (e) {
                if (!e.target.closest || !e.target.closest('.nav-dropdown')) closeDropdown();
            });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeDropdown();
            });
        }

        document.querySelectorAll('.nav-dropdown-panel a.nav-link').forEach(function (a) {
            a.addEventListener('click', function () { closeDropdown(); });
        });
    }

    window.bindExplorerNav = bindExplorerNav;
    window.closeExplorerNav = closeDropdown;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindExplorerNav);
    } else {
        bindExplorerNav();
    }
})();
