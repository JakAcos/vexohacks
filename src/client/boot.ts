// Relay client entry. The chat workspace is the default; the original operations
// dashboard stays available at ?view=classic so nothing that worked is removed.
const classic = new URLSearchParams(window.location.search).get("view") === "classic";
if (classic) void import("./main");
else void import("./chat/RelayChat");
