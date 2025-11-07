/**
 * Inject CSS as a <style> element so it can be inspected and modified in DevTools.
 * Based on: https://github.com/lateral/chrome-extension-blogpost/compare/master...paulirish:master
 */
export const injectStyles = (cssText, id) => {
  const style = document.createElement('style');
  style.textContent = cssText;
  if (id) {
    style.id = id;
  }
  (document.head || document.documentElement).appendChild(style);
};
