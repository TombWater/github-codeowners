// Small replacements for the two lodash functions we used. lodash needed a
// patch: its `Function('return this')` is blocked by GitHub's CSP.

// Call fn once calls stop for `wait` ms, with the last call's arguments.
export const debounce = (fn, wait) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

// Cache just one result, and call fn again when the key changes. cacheKey gets
// fn's arguments. An async fn caches its promise, so callers share a fetch.
//
// Every cache of ours goes through this, with a named key function: the
// `...CacheKey` functions at the top of github.js, where a new one joins them.
// A key function runs on every call, so it must be cheap and synchronous (read
// the URL or the DOM, never fetch). Keys are compared with `!==`: return a
// string naming what the data depends on, or an object (a DOM element) when
// its identity is what changes.
export const cacheResult = (cacheKey, fn) => {
  let key, value;
  return (...args) => {
    const newKey = cacheKey(...args);
    if (newKey !== key) {
      value = fn(...args);
      // Only after fn returns: if it throws, the next call tries again
      key = newKey;
    }
    return value;
  };
};
