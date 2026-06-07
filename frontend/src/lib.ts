// Anonymous per-device id for free-tier limits + Pro entitlement (no login).
export function deviceId(): string {
  let id = localStorage.getItem("ss_device");
  if (!id) {
    id =
      crypto.randomUUID?.() ??
      `d-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    localStorage.setItem("ss_device", id);
  }
  return id;
}

export interface Entitlement {
  pro: boolean;
  reviewsUsed: number;
  freeReviews: number;
  billingEnabled: boolean;
}

export async function fetchEntitlement(): Promise<Entitlement> {
  try {
    const r = await fetch(`/entitlement?device=${encodeURIComponent(deviceId())}`);
    if (r.ok) return await r.json();
  } catch {
    /* offline */
  }
  return { pro: false, reviewsUsed: 0, freeReviews: 2, billingEnabled: false };
}
