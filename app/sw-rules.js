// Naming rules for the service worker's caches. No browser features are used
// here, so these can be tested with `node --test`. Plain script (not a module)
// because the service worker loads it with importScripts, as proven on the phone.
//
// The ":" after the storage name matters. Copies on this host share caches, and
// with a plain prefix, a copy named "abc" would also match the caches of a copy
// named "abc-2" and delete its files. "abc:files:" cannot match "abc-2:files:".
self.GAMEDAY_SW_RULES = {
  /** The cache holding one version's files. */
  filesCacheName(storageName, version) {
    return storageName + ":files:" + version;
  },

  /** The small cache that remembers which version's files are in use. */
  markerCacheName(storageName) {
    return storageName + ":marker";
  },

  /** Which caches to delete once `version` is in use: only this copy's older files. */
  cachesToDelete(allCacheNames, storageName, version) {
    const ours = storageName + ":files:";
    const keep = ours + version;
    return allCacheNames.filter((name) => name.startsWith(ours) && name !== keep);
  },
};
