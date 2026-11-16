/* The only place the web app builds FOMO URLs. Same strings as links.py. */
(function (g) {
  "use strict";
  var CHAIN_ID = { solana: 1399811149, robinhood: 4663, base: 8453, bnb: 56 };
  var SIGNUP_URL = "https://fomo.family/r/savipww";
  function coin_url(address, chain) {
    chain = chain || "solana";
    if (!CHAIN_ID.hasOwnProperty(chain)) return SIGNUP_URL;
    return "https://fomo.family/coin?address=" + address + "&chainId=" + CHAIN_ID[chain] + "&r=savipww&source=share_link";
  }
  function profile_url(handle) {
    var h = String(handle || "").replace(/^@/, "");
    return "https://fomo.family/profile/" + h + "?source=share_link&r=savipww";
  }
  g.FOMO_LINKS = { CHAIN_ID: CHAIN_ID, SIGNUP_URL: SIGNUP_URL, coin_url: coin_url, profile_url: profile_url };
})(typeof window !== "undefined" ? window : globalThis);
