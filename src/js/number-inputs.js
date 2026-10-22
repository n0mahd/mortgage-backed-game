// Number boxes change only when you type in them. Scrolling with a mouse
// wheel or trackpad over a focused box scrolls the page instead of nudging
// the value, and the arrow keys don't step it either. The spin buttons are
// hidden in style.css.
(function () {
    'use strict';

    function numberInput(target) {
        return target && target.closest ? target.closest('input[type="number"]') : null;
    }

    // Blurring before the browser handles the wheel lets the page scroll and
    // leaves the value alone.
    document.addEventListener('wheel', event => {
        const input = numberInput(event.target);
        if (input && document.activeElement === input) input.blur();
    }, { capture: true, passive: true });

    document.addEventListener('keydown', event => {
        if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && numberInput(event.target)) {
            event.preventDefault();
        }
    }, true);
})();
