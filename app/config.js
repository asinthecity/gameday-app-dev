// The ONE file that names this copy of the app.
//
// Every copy on the same web host shares one browser storage area, so each
// copy needs its own name. The database is called this, and every cache starts
// with it. To make the real copy, change this one word (for example to
// "gameday-live") and nothing else. Never reuse a name another copy has used:
// that copy's saved data would be opened by this one.
self.GAMEDAY_CONFIG = {
  storageName: "gameday-test",
  // Which tab of the Sheet this copy writes to: "Test" here, "Season" on the real copy.
  // Change it together with storageName when publishing the real copy.
  sheetTab: "Test",
};
