// We will make use of Storage API to get and store `token` value
// More information on Storage API can we found at
// https://developer.chrome.com/extensions/storage

// To get storage access, we have to mention it in `permissions` property of manifest.json file
// More information on Permissions can we found at
// https://developer.chrome.com/extensions/declare_permissions

export const tokenStorage = {
  get: () =>
    new Promise((resolve) => {
      chrome.storage.local.get(['token'], (result) => {
        console.log('Token currently is', result.token);
        resolve(result.token);
      });
    }),
  set: (token) =>
    new Promise((resolve) => {
      chrome.storage.local.set({token}, () => {
        console.log('Token set to', token);
        resolve(token);
      });
    }),
  listen: (cb) => {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.token) {
        cb(changes.token.newValue);
      }
    });
  },
};
