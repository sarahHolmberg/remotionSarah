// app/mail.ts
// NEW FILE: an email every time a render starts, through Web3Forms (the same service and key as the availability
// site's config.js). Web3Forms' free plan only accepts mail sent from a browser, not from a server, so the mail goes
// out from the page that starts the render: Parrot's Send, the simple view's Create, the editor's Export video and
// the editor bar's Retry. It never blocks or breaks anything: a failed mail is only logged.
// The key decides where the mail goes (the inbox it was made for at web3forms.com); change it here to use another.
const WEB3FORMS_KEY = "2fd09af2-d997-42d9-ae86-189446376e29";

export const mailRenderStarted = (from: string, details: Record<string, string | number> = {}) => {
  const form = new FormData();
  form.append("access_key", WEB3FORMS_KEY);
  form.append("subject", `Render started (${from})`);
  form.append("from_name", "Comic studio");
  form.append("Started from", from);
  form.append("Time", new Date().toLocaleString("en-GB", {timeZone: "Europe/Stockholm"}) + " (Stockholm)");
  for (const [k, v] of Object.entries(details)) form.append(k, String(v));
  console.log(`[Mail] render started (${from}), sending the email`);
  fetch("https://api.web3forms.com/submit", {method: "POST", headers: {Accept: "application/json"}, body: form})
    .then((r) => r.json().catch(() => ({})).then((d) => console.log(`[Mail] answer ${r.status}`, d)))
    .catch((e) => console.warn("[Mail] could not send", e));
};
