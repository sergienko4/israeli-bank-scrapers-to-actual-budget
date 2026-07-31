/**
 * Fills in the approval page from the query the portal redirected with.
 *
 * The device name is chosen by whoever built the authorize link, so it is
 * written with `textContent` and never parsed as markup. The approve link is
 * rebuilt here rather than carried in the page, so it can only ever point back
 * at this portal's own authorize route.
 */

const params = new URLSearchParams(window.location.search);

const device = document.getElementById('device');
if (device) {
  device.textContent = params.get('device_name') || 'A device';
}

const approve = document.getElementById('approve');
if (approve) {
  approve.href = `/auth/app/authorize?${params.toString()}`;
}
