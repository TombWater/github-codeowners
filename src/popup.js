'use strict';

import './popup.css';
import {tokenStorage} from './storage';

(function () {
  async function restoreToken() {
    const token = await tokenStorage.get();
    const tokenInput = document.getElementById('token')

    tokenInput.value = token ?? '';

    let timeout;

    tokenInput.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        tokenStorage.set(tokenInput.value);
      }, 500);
    });
  }

  document.addEventListener('DOMContentLoaded', restoreToken);

  // Communicate with background file by sending a message
  chrome.runtime.sendMessage(
    {
      type: 'GREETINGS',
      payload: {
        message: 'Hello, my name is Pop. I am from Popup.',
      },
    },
    (response) => {
      console.log(response.message);
    }
  );
})();
