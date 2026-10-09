// HyperMD, copyright (c) by laobubu
// Distributed under an MIT license: http://laobubu.net/HyperMD/LICENSE
//

(function (mod){ //[HyperMD] UMD patched!
  /*commonjs*/  ("object"==typeof exports&&"undefined"!=typeof module) ? mod(exports, require("mermaid"), require("hypermd/addon/fold-code")) :
  /*amd*/       ("function"==typeof define&&define.amd) ? define(["exports","mermaid","hypermd/addon/fold-code"], mod) :
  /* PATCHED: original passed bare `mermaid`; with lazy loading the global isn't
     defined at parse time, which threw a ReferenceError. Probe with typeof. */
  /*plain env*/ mod((this.HyperMD_PowerPack = this.HyperMD_PowerPack || {}, this.HyperMD_PowerPack.mermaid = this.HyperMD_PowerPack.mermaid || {}), (typeof mermaid !== 'undefined' ? mermaid : undefined), HyperMD.FoldCode);
})(function (exports, mermaid__, _$MOD1) {
  var registerRenderer = _$MOD1.registerRenderer;

var mermaidIdPrefix = "_mermaid_" + Math.random().toString(36).slice(2, 18) + "_";
var mermaidCounter = 0;

// PATCHED: lazy-load mermaid.min.js (~3 MB) only when the first ```mermaid block
// is encountered. Until then, no network or parse cost. Cached at module scope
// so concurrent renders share one load.
var mermaidLoad = null;
function ensureMermaidLoaded() {
    if (window.mermaid && typeof window.mermaid.render === 'function') {
        return Promise.resolve(window.mermaid);
    }
    if (mermaidLoad) return mermaidLoad;
    mermaidLoad = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        // Match the same ?v= cache-buster the rest of the app uses, so the
        // service worker stores it under the current commit hash.
        // Use a relative path (matches the other <script src="lib/..."> tags in
        // index.html) so the app works when hosted under a sub-path or via a
        // dev server that doesn't serve from origin root.
        s.src = 'lib/mermaid.min.js' + (window.COMMIT_HASH || '');
        s.onload = function () {
            if (window.mermaid && typeof window.mermaid.initialize === 'function') {
                try {
                    // Pull theme accents from CSS variables (with hardcoded
                    // fallbacks) and hand them to mermaid so diagrams match
                    // the app instead of mermaid's default lavender + faint grey.
                    var rootStyle = getComputedStyle(document.documentElement);
                    var orange = (rootStyle.getPropertyValue('--color-neo-orange') || '').trim() || '#e8912d';
                    var blue   = (rootStyle.getPropertyValue('--color-neo-blue')   || '').trim() || '#2E5CFF';
                    var textCol = (rootStyle.getPropertyValue('--col-tx')           || '').trim() || '#1A1A1A';
                    window.mermaid.initialize({
                        startOnLoad: false,
                        securityLevel: 'loose',
                        theme: 'base',
                        themeVariables: {
                            primaryColor: orange,
                            primaryBorderColor: orange,
                            primaryTextColor: '#1A1A1A',
                            pie1: orange,
                            // Sequence-diagram message arrows and the generic
                            // line color: use neo-blue so the connectors are
                            // visible on either theme (default is near-black).
                            lineColor: blue,
                            signalColor: blue,
                            // Most label-style text uses the theme's --col-tx so
                            // it stays readable in both light and dark themes.
                            textColor: textCol,
                            labelTextColor: textCol,
                            loopTextColor: textCol,
                            signalTextColor: textCol,
                            actorTextColor: textCol,
                            // Notes have a fixed light-yellow background in
                            // mermaid's base theme, so the text on them needs
                            // to be dark regardless of the page theme.
                            noteTextColor: '#1A1A1A',
                        },
                    });
                }
                catch (e) { console.warn("[hypermd-mermaid] initialize failed:", e); }
            }
            resolve(window.mermaid);
        };
        s.onerror = function () { mermaidLoad = null; reject(new Error("mermaid load failed")); };
        document.head.appendChild(s);
    });
    return mermaidLoad;
}

// PATCHED: renderer rewritten from the upstream callback-only version to
//   1. wait for ensureMermaidLoaded() (lazy-load path) before touching mermaid
//   2. support both the Promise API (mermaid v10+) and the legacy callback
//      API (mermaid v9 and below); upstream only knew the callback shape
//   3. fall back to raw code text on any error so a malformed diagram or a
//      failed lib load doesn't crash the fold widget
var mermaidRenderer = function (code, info) {
    var id = mermaidIdPrefix + (mermaidCounter++).toString(36);
    var el = document.createElement('div');
    el.setAttribute('id', id);
    el.setAttribute('class', 'hmd-fold-code-image hmd-fold-code-mermaid');
    el.textContent = 'Loading mermaid…';
    ensureMermaidLoaded().then(function (mermaid) {
        var result;
        try { result = mermaid.render(id + '_svg', code); }
        catch (err) {
            console.error("[hypermd-mermaid] render threw:", err);
            el.textContent = code;
            info.changed();
            return;
        }
        if (result && typeof result.then === 'function') {
            // mermaid v10+ Promise API
            return result.then(function (out) {
                var svgCode = out && (out.svg || out);
                var bindFunctions = out && out.bindFunctions;
                el.innerHTML = svgCode;
                el.removeAttribute('id');
                if (typeof bindFunctions === 'function') bindFunctions(el);
                info.changed();
            }).catch(function (err) {
                console.error("[hypermd-mermaid] render error:", err);
                el.textContent = code;
                info.changed();
            });
        } else {
            // mermaid v9 and below callback API
            mermaid.render(id, code, function (svgCode, bindFunctions) {
                el.innerHTML = svgCode;
                el.removeAttribute('id');
                if (typeof bindFunctions === 'function') bindFunctions(el);
                info.changed();
            });
        }
    }).catch(function (err) {
        console.error("[hypermd-mermaid] could not load mermaid:", err);
        el.textContent = code;
        info.changed();
    });
    return el;
};

registerRenderer({
    name: "mermaid",
    pattern: /^mermaid$/i,
    renderer: mermaidRenderer,
    suggested: true,
});

exports.mermaidRenderer = mermaidRenderer;
});
