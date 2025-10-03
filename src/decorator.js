import {debounce} from 'lodash-es';

import {updatePrFilesPage} from './files-page';
import {updateMergeBox} from './conversation-page';

import './decorator.css';

const updateAll = async () => {
  await Promise.all([updatePrFilesPage(), updateMergeBox()]);
};

// Potentially refresh after every mutation, with debounce
const observer = new MutationObserver(debounce(updateAll, 100));
observer.observe(document.body, {childList: true, subtree: true});

// Delete the disused access token that may still be in storage from the previous version
chrome.storage.local.remove('token');
