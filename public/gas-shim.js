/**
 * Replaces google.script.run so your existing Index/Admin code works unchanged
 * on Vercel. Every call is sent to your Apps Script Web App (doPost in Api.gs).
 */
(function () {
  var API_URL = 'https://script.google.com/macros/s/AKfycbx7pr8GxbjhY-8-OkhYhi497yKvZV9zkjv4bZJk2EvIxlCQPi6tMlYYTA00NdzdMDRj/exec';

  function call(fn, args, ok, fail) {
    var failed = function (err) {
      if (typeof fail === 'function') fail(err instanceof Error ? err : new Error(String(err)));
      else console.error('google.script.run.' + fn + ' failed:', err);
    };
    fetch(API_URL, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script does not support
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      redirect: 'follow'
    })
      .then(function (res) { return res.text(); })
      .then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { throw new Error('Invalid response from server.'); }
        if (data && data.error) throw new Error(data.error);
        return data ? data.result : null;
      })
      .then(
        function (result) { if (typeof ok === 'function') ok(result); },
        failed
      );
  }

  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        if (name === 'withUserObject') return function () { return runner(ok, fail); };
        return function () { call(name, Array.prototype.slice.call(arguments), ok, fail); };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = { run: runner(null, null) };
})();
