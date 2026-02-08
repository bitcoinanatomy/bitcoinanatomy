/**
 * Shared controls-camera component: View (rotation, ortho, hide UI, reset) + Rotate + Pan + Zoom.
 * Renders into a container; each page wires up #toggle-rotation, #toggle-view, #toggle-ui, #reset-camera,
 * #rotate-left, #rotate-right, etc. in its own JS.
 * @param {HTMLElement} container - Element to append the controls into (e.g. #controls-camera-root).
 * @param {{ viewGroup?: boolean }} [options] - viewGroup: true to show View group (default true).
 */
function ControlsCamera(container, options) {
    if (!container) return;
    const viewGroup = options && options.viewGroup !== undefined ? options.viewGroup : true;
    const iconPath = 'imgs/icons';

    const viewGroupHtml = viewGroup
        ? `
    <div class="control-group">
        <div class="control-label">View</div>
        <div class="control-buttons">
            <button id="toggle-rotation" title="Pause rotation" aria-label="Pause rotation">
                <img id="toggle-rotation-icon" class="control-icon-svg" src="${iconPath}/pause.svg" alt="">
            </button>
            <button id="toggle-view" title="Switch to orthographic" aria-label="Orthographic view">
                <img id="toggle-view-icon" class="control-icon-svg" src="${iconPath}/orthographic.svg" alt="">
            </button>
            <button id="toggle-ui" title="Hide UI" aria-label="Hide UI">
                <img id="toggle-ui-icon" class="control-icon-svg" src="${iconPath}/eye.svg" alt="">
            </button>
            <button id="reset-camera" title="Reset view" aria-label="Reset view">
                <img class="control-icon-svg" src="${iconPath}/reset-view.svg" alt="">
            </button>
        </div>
    </div>`
        : '';

    const html = `
<div class="navigation-controls">
    ${viewGroupHtml}
    <div class="control-group">
            <div class="control-label">Rotate</div>
            <div class="control-buttons">
                <button id="rotate-left" title="Rotate left" aria-label="Rotate left"><img class="control-icon-svg" src="${iconPath}/arrow-left.svg" alt=""></button>
                <button id="rotate-right" title="Rotate right" aria-label="Rotate right"><img class="control-icon-svg" src="${iconPath}/arrow-right.svg" alt=""></button>
                <button id="rotate-up" title="Rotate up" aria-label="Rotate up"><img class="control-icon-svg" src="${iconPath}/arrow-up.svg" alt=""></button>
                <button id="rotate-down" title="Rotate down" aria-label="Rotate down"><img class="control-icon-svg" src="${iconPath}/arrow-down.svg" alt=""></button>
            </div>
        </div>
        <div class="control-group">
            <div class="control-label">Pan</div>
            <div class="control-buttons">
                <button id="pan-left" title="Pan left" aria-label="Pan left"><img class="control-icon-svg" src="${iconPath}/arrow-left.svg" alt=""></button>
                <button id="pan-right" title="Pan right" aria-label="Pan right"><img class="control-icon-svg" src="${iconPath}/arrow-right.svg" alt=""></button>
                <button id="pan-up" title="Pan up" aria-label="Pan up"><img class="control-icon-svg" src="${iconPath}/arrow-up.svg" alt=""></button>
                <button id="pan-down" title="Pan down" aria-label="Pan down"><img class="control-icon-svg" src="${iconPath}/arrow-down.svg" alt=""></button>
            </div>
        </div>
        <div class="control-group">
            <div class="control-label">Zoom</div>
            <div class="control-buttons">
                <button id="zoom-in" title="Zoom in" aria-label="Zoom in"><img class="control-icon-svg" src="${iconPath}/zoom-in.svg" alt=""></button>
                <button id="zoom-out" title="Zoom out" aria-label="Zoom out"><img class="control-icon-svg" src="${iconPath}/zoom-out.svg" alt=""></button>
            </div>
        </div>
    </div>`;

    container.innerHTML = html;
    container.classList.add('controls-camera');

    if (viewGroup) {
        var toggleUi = document.getElementById('toggle-ui');
        if (toggleUi) {
            toggleUi.addEventListener('click', function () {
                document.body.classList.toggle('ui-hidden');
                toggleUi.title = document.body.classList.contains('ui-hidden') ? 'Show UI' : 'Hide UI';
                toggleUi.setAttribute('aria-label', toggleUi.title);
            });
        }
        var uiEl = document.getElementById('ui');
        var navEl = document.querySelector('.navbar');
        if (uiEl && navEl) {
            var leaveTimer = null;
            var lastX = 0, lastY = 0;
            var containerEl = document.getElementById('container');
            if (containerEl) {
                containerEl.addEventListener('mousemove', function (e) {
                    if (document.body.classList.contains('ui-hidden')) {
                        lastX = e.clientX;
                        lastY = e.clientY;
                    }
                });
            }
            function addReveal() {
                if (document.body.classList.contains('ui-hidden')) {
                    document.body.classList.add('ui-hover-reveal');
                }
            }
            function scheduleRemove() {
                if (leaveTimer) clearTimeout(leaveTimer);
                leaveTimer = setTimeout(function () {
                    leaveTimer = null;
                    var el = document.elementFromPoint(lastX, lastY);
                    if (el && !uiEl.contains(el) && !navEl.contains(el)) {
                        document.body.classList.remove('ui-hover-reveal');
                    }
                }, 150);
            }
            uiEl.addEventListener('mouseenter', addReveal);
            uiEl.addEventListener('mouseleave', scheduleRemove);
            navEl.addEventListener('mouseenter', addReveal);
            navEl.addEventListener('mouseleave', scheduleRemove);
        }
    }
}

// Support both global (script tag) and module usage
if (typeof window !== 'undefined') {
    window.ControlsCamera = ControlsCamera;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ControlsCamera;
}
