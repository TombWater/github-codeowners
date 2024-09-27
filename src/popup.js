'use strict';

import {debounce} from 'lodash-es';

import './popup.css';

import {tokenStorage} from './storage';

(function () {
  async function restoreToken() {
    const token = await tokenStorage.get();
    const tokenInput = document.getElementById('token');

    tokenInput.value = token ?? '';

    const storeToken = () => tokenStorage.set(tokenInput.value);
    tokenInput.addEventListener('input', debounce(storeToken, 500));
  }

  document.addEventListener('DOMContentLoaded', restoreToken);
})();
