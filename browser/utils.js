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
