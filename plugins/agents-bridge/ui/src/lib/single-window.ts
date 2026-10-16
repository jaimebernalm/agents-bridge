// One window per panel. Every page on this origin belongs to the same chat's panel, so when a
// newer page connects the older ones step aside. Newest means opened last, not connected last.
type Claim = {at: number; id: string};
type Channel = {postMessage(message: Claim): void; close(): void; onmessage: ((event: MessageEvent) => void) | null};
type Handlers = {hasDraft: () => boolean; onReplaced: () => void; onSuperseded: () => void};
const newer = (a: Claim, b: Claim) => a.at > b.at || a.at === b.at && a.id > b.id;

export function claimPanelWindow(handlers: Handlers, channel: Channel | undefined = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('agents-bridge-panel'),
  mine: Claim = {at: performance.timeOrigin, id: crypto.randomUUID()}, now = () => performance.timeOrigin + performance.now()) {
  if (!channel) return {release() {}, reclaim() {}};
  let newest = true, latest = mine.at;
  channel.onmessage = event => {
    const other = event.data as Claim;
    if (typeof other?.at !== 'number' || typeof other.id !== 'string') return;
    latest = Math.max(latest, other.at);
    // An older page that connected after this one learns that it is not the newest.
    if (!newer(other, mine)) {channel.postMessage(mine); return;}
    // Text the person has not sent keeps this window open; it offers the choice instead.
    if (handlers.hasDraft()) {if (newest) {newest = false; handlers.onSuperseded();} return;}
    // Claims already in flight must not report the same replacement twice.
    channel.onmessage = null; channel.close(); handlers.onReplaced();
  };
  channel.postMessage(mine);
  return {
    release() {channel.onmessage = null; channel.close();},
    // Taking the panel back must beat every claim seen so far, even when a coarse clock ties them.
    reclaim() {mine = {at: Math.max(now(), latest) + 1, id: mine.id}; newest = true; channel.postMessage(mine);},
  };
}
