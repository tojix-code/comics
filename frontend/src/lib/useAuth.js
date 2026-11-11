import { useSyncExternalStore } from 'react';
import { getSessionUser, publicUser, storeEvents } from './store';

function subscribe(fn) {
  return storeEvents.subscribe(fn);
}
function getSnapshot() {
  return getSessionUser()?.email || '';
}

/** Current signed-in user (public fields only), reactive to login/logout. */
export function useCurrentUser() {
  const email = useSyncExternalStore(subscribe, getSnapshot);
  return email ? publicUser(getSessionUser()) : null;
}

/** A counter that bumps whenever library/catalogue/reports data changes. */
let version = 0;
storeEvents.subscribe(() => { version += 1; });
export function useDataVersion() {
  return useSyncExternalStore(subscribe, () => version);
}
