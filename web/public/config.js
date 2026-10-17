// Runtime settings, read once when the page loads. This is the ONE place the
// frontend learns where the API is — locally and when deployed. On a server,
// edit the deployed copy (next to index.html); no rebuild needed.
//
// apiBaseUrl: the API's address, without /api/v1.
//   "http://localhost:5001"    local development (dotnet run --launch-profile http)
//   "http://localhost:8080"    the API deployed as its own IIS site
//   ""                         the API serves this frontend itself (one site)
//
// The API must allow this frontend's address in Cors:Origins (appsettings).
window.LEASH_CONFIG = {
  apiBaseUrl: "http://localhost:5001",
};
