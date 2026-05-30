function normalizeDateOnly(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function parseCnDateTime(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseContractContent(contract = {}) {
  if (typeof contract.content_json === 'string') {
    try {
      const parsed = JSON.parse(contract.content_json);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return contract.content_json && typeof contract.content_json === 'object' ? contract.content_json : {};
}

function parseContractStartAtMs(contract = {}) {
  const content = parseContractContent(contract);
  const exactStartAtMs = Number(content?.renewal?.startAtMs || 0);
  if (Number.isFinite(exactStartAtMs) && exactStartAtMs > 0) return exactStartAtMs;
  const startDateOnly = normalizeDateOnly(content?.terms?.startDate);
  if (!startDateOnly) return 0;
  const d = new Date(`${startDateOnly}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseContractEndAtMs(contract = {}) {
  const content = parseContractContent(contract);
  const endDateOnly = normalizeDateOnly(content?.terms?.endDate);
  if (!endDateOnly) return 0;
  const d = new Date(`${endDateOnly}T23:59:59+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function normalizeListingBodyStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'rented' ? 'available' : normalized;
}

function isTerminalContractStatus(status) {
  return ['cancelled', 'expired', 'ended', 'completed'].includes(String(status || '').trim().toLowerCase());
}

function isContractCurrentlyOccupying(contract, now = Date.now()) {
  const startAtMs = parseContractStartAtMs(contract);
  const endAtMs = parseContractEndAtMs(contract);
  return String(contract.status || '').trim().toLowerCase() === 'active'
    && startAtMs > 0
    && startAtMs <= now
    && now < endAtMs;
}

function isContractSigningOrReserved(contract, now = Date.now()) {
  const status = String(contract.status || '').trim().toLowerCase();
  if (status === 'pending' || status === 'tenant_signed') {
    const deadline = parseCnDateTime(contract.expires_at);
    return !!deadline && deadline.getTime() > now;
  }
  if (status === 'pending_payment') {
    const deadline = parseCnDateTime(contract.payment_deadline || contract.expires_at);
    return !!deadline && deadline.getTime() > now;
  }
  if (status === 'active') {
    const startAtMs = parseContractStartAtMs(contract);
    const endAtMs = parseContractEndAtMs(contract);
    return startAtMs > now && endAtMs > now;
  }
  return false;
}

function resolveListingPublicState(listing, contracts = [], now = Date.now()) {
  const bodyStatus = normalizeListingBodyStatus(listing?.status);
  if (bodyStatus !== 'available') {
    return {
      bodyStatus,
      publicStatus: bodyStatus,
      activeContract: null,
      signingContract: null,
    };
  }

  const activeContract = contracts
    .filter((contract) => isContractCurrentlyOccupying(contract, now))
    .sort((a, b) => parseContractStartAtMs(b) - parseContractStartAtMs(a))[0] || null;

  const signingContract = contracts
    .filter((contract) => !activeContract || contract.id !== activeContract.id)
    .filter((contract) => isContractSigningOrReserved(contract, now))
    .sort((a, b) => {
      const aDeadline = parseCnDateTime(a.payment_deadline || a.expires_at)?.getTime() || 0;
      const bDeadline = parseCnDateTime(b.payment_deadline || b.expires_at)?.getTime() || 0;
      return bDeadline - aDeadline;
    })[0] || null;

  return {
    bodyStatus,
    publicStatus: activeContract ? 'rented' : (signingContract ? 'signing' : 'available'),
    activeContract,
    signingContract,
  };
}

module.exports = {
  normalizeDateOnly,
  parseCnDateTime,
  parseContractContent,
  parseContractStartAtMs,
  parseContractEndAtMs,
  normalizeListingBodyStatus,
  isTerminalContractStatus,
  isContractCurrentlyOccupying,
  isContractSigningOrReserved,
  resolveListingPublicState,
};
