import Data from "../models/Data.js";
import User from "../models/User.js";
import Winner from "../models/Winner.js";
import Draw from "../models/Draw.js";

const addDataForTimeSlot = async (req, res) => {
        // Requires drawId (no longer accepts legacy timeSlot)
        const { drawId, data, category, userId: targetUserIdBody } = req.body;
    try {
                // drawId is required
                if (!drawId) return res.status(400).json({ error: 'drawId is required' });
                // Validate draw and derive date
                const draw = await Draw.findById(drawId);
                if (!draw) return res.status(404).json({ error: 'Draw not found' });
                // Block adding data when draw is closed/expired
                if (draw.isExpired) return res.status(400).json({ error: 'Draw is closed. Cannot add data.' });

        // Calculate total amount from firstPrice and secondPrice
        const totalAmount = data.reduce((sum, item) => {
            return sum + item.firstPrice + item.secondPrice;
        }, 0);
        // Determine whose balance to use: explicit userId from distributor/admin, else caller
        const effectiveUserId = targetUserIdBody || req.query.userId || req.user.id;
        // Find the user and check if they have sufficient balance
        const user = await User.findById(effectiveUserId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (user.balance < totalAmount) {
            return res.status(400).json({ 
                error: "Insufficient balance", 
                currentBalance: user.balance,
                requiredAmount: totalAmount 
            });
        }
    const dataDate = draw.draw_date;
    const newData = new Data({ userId : effectiveUserId, drawId: draw._id, category, data, date : dataDate });
        await newData.save();
        // Deduct the total amount from user's balance
        user.balance -= totalAmount;
        await user.save();
        
        res.status(201).json({ message: "Data added successfully" , newData });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}

const addOverlimitData = async (req, res) => {
    const { drawId, data, category } = req.body;
    const userId = req.query.userId || req.user.id; 
    try {
        // Find the user and check if they have sufficient balance
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
                // drawId is required for overlimit/demand data as well
                if (!drawId) return res.status(400).json({ error: 'drawId is required' });
                const draw = await Draw.findById(drawId);
                if (!draw) return res.status(404).json({ error: 'Draw not found' });
                // Block adding overlimit/demand when draw is closed/expired
                if (draw.isExpired) return res.status(400).json({ error: 'Draw is closed. Cannot add data.' });
                const dataDate = draw.draw_date;
                const newData = new Data({ userId : userId, drawId: draw._id, category, data, date : dataDate });
        await newData.save();
        
        res.status(201).json({ message: "Data added successfully" , newData });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}

// Save demand records for a specific party and draw. If a demand document exists, merge/update entries;
// otherwise create a new Data document with category 'demand'. This endpoint does not deduct balance.
const saveDemandRecords = async (req, res) => {
    const { drawId, records, partyId, replace, forceProtected, prizeType } = req.body;
    const userId = partyId || req.body.userId || req.user.id;
    if (!drawId) return res.status(400).json({ error: 'drawId is required' });
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records array is required' });

    try {
        const draw = await Draw.findById(drawId);
        if (!draw) return res.status(404).json({ error: 'Draw not found' });
        // Prevent saving demand if draw is closed/expired
        if (draw.isExpired) return res.status(400).json({ error: 'Draw is closed. Demand cannot be saved.' });

        // Aggregate incoming records by uniqueId so duplicates in the payload are summed
        const aggregated = new Map();
        for (const r of records) {
            const uid = String(r.uniqueId || r.number || r.id || '').trim();
            if (!uid) continue; // skip empty ids
            const f = Number(r.firstPrice ?? r.fPrize ?? 0) || 0;
            const s = Number(r.secondPrice ?? r.sPrize ?? 0) || 0;
            if (aggregated.has(uid)) {
                const prev = aggregated.get(uid);
                prev.firstPrice += f;
                prev.secondPrice += s;
            } else {
                aggregated.set(uid, { uniqueId: uid, firstPrice: f, secondPrice: s, archived: false, locked: false, archiveId: null });
            }
        }

        // If no valid rows after aggregation, return
        // If no valid rows after aggregation, we don't fail immediately.
        // Allow updating overlimit snapshot / lastCombined even when there are no positive deltas to persist.
        const aggregatedEmpty = aggregated.size === 0;

        // Parse combined snapshot from request (required to compute deltas)
        const combinedPayload = Array.isArray(req.body.combined) ? req.body.combined : [];
        const combinedMap = new Map();
        for (const c of combinedPayload) {
            const uid = String(c.uniqueId || c.no || c.number || c.id || '').trim();
            if (!uid) continue;
            const f = Number(c.firstPrice ?? c.f ?? c.fPrize ?? 0) || 0;
            const s = Number(c.secondPrice ?? c.s ?? c.sPrize ?? 0) || 0;
            if (combinedMap.has(uid)) {
                const prev = combinedMap.get(uid);
                prev.firstPrice += f;
                prev.secondPrice += s;
            } else {
                combinedMap.set(uid, { uniqueId: uid, firstPrice: f, secondPrice: s });
            }
        }

        // Build set of protected UIDs from existing overlimit doc (archived && locked)
        const protectedUids = new Set();
        try {
            const overlimitDoc = await Data.findOne({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
            if (overlimitDoc && Array.isArray(overlimitDoc.data)) {
                for (const od of overlimitDoc.data) {
                    try {
                        const uid = String(od.uniqueId || '').trim();
                        if (od.archived === true && od.locked === true && uid) protectedUids.add(uid);
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (e) {
            console.warn('[saveDemandRecords] failed to load overlimit doc for protected UIDs', e.message || e);
        }

        let existing = await Data.findOne({ userId, drawId, category: 'demand', ...(prizeType ? { prizeType } : {}) });

        // If caller requested replace/overwrite semantics, replace existing demand data
        if (replace) {
            const incomingRowsAll = Array.from(aggregated.values()).map(r => ({ uniqueId: r.uniqueId, firstPrice: r.firstPrice, secondPrice: r.secondPrice, archived: false, locked: false, archiveId: null }));
            const incomingSnapshot = Array.from(aggregated.values()).map(r => ({ uniqueId: r.uniqueId, firstPrice: r.firstPrice, secondPrice: r.secondPrice }));
            const incomingCombinedSnapshot = Array.from(combinedMap.values()).map(r => ({ uniqueId: r.uniqueId, firstPrice: r.firstPrice, secondPrice: r.secondPrice }));

            // Separate protected vs updatable incoming rows
            const incomingRowsByKey = new Map();
            for (const r of incomingRowsAll) incomingRowsByKey.set(String(r.uniqueId).trim(), r);

            // Build new demand data: keep protected entries from existing demand, replace others with incoming
            const newDemandData = [];
            const protectedSet = protectedUids;

            // Preserve existing protected demand entries (if present)
            if (existing && Array.isArray(existing.data)) {
                for (const d of existing.data) {
                    const k = String(d.uniqueId).trim();
                    if (protectedSet.has(k)) {
                        newDemandData.push(d);
                        // also remove from incomingRowsByKey to avoid duplicate
                        incomingRowsByKey.delete(k);
                    }
                }
            }

            // Append remaining incoming (unprotected) rows
            for (const [k, r] of incomingRowsByKey.entries()) {
                if (protectedSet.has(k)) continue;
                newDemandData.push(r);
            }

            if (existing) {
                existing.data = newDemandData;
                existing.lastAnalyzed = incomingSnapshot;
                existing.lastCombined = incomingCombinedSnapshot;
                existing.date = draw.draw_date;
                if (prizeType) existing.prizeType = prizeType;
                await existing.save();
            } else {
                const newData = new Data({ userId, drawId, category: 'demand', prizeType: prizeType || undefined, data: newDemandData, lastAnalyzed: incomingSnapshot, lastCombined: incomingCombinedSnapshot, date: draw.draw_date });
                await newData.save();
                existing = newData;
            }

            // Recompute overlimit for unprotected UIDs only, and merge with protected overlimit rows
            const cumulativeMapForOver = new Map();
            if (existing && Array.isArray(existing.data)) {
                for (const d of existing.data) {
                    const k = String(d.uniqueId).trim();
                    cumulativeMapForOver.set(k, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
                    const numKey = String(Number(k.replace(/^0+/, '') || k));
                    if (!cumulativeMapForOver.has(numKey)) cumulativeMapForOver.set(numKey, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
                }
            }

            // build archivedMap for this branch
            const archivedMapReplace = new Map();
            try {
                const overDocsAll = await Data.find({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
                for (const od of overDocsAll) {
                    if (!Array.isArray(od.data)) continue;
                    for (const r of od.data) {
                        try {
                            if (r && r.uniqueId && r.archived === true) {
                                const k = String(r.uniqueId).trim();
                                const f = Number(r.firstPrice) || 0;
                                const s = Number(r.secondPrice) || 0;
                                if (!archivedMapReplace.has(k)) archivedMapReplace.set(k, { firstPrice: f, secondPrice: s });
                                else {
                                    const prev = archivedMapReplace.get(k);
                                    prev.firstPrice = Math.max(prev.firstPrice || 0, f);
                                    prev.secondPrice = Math.max(prev.secondPrice || 0, s);
                                    archivedMapReplace.set(k, prev);
                                }
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) { /* ignore */ }

            let computedOver = [];
            for (const [uid, combined] of combinedMap.entries()) {
                // Treat identical incoming UIDs as fresh entries (Option B)
                const cum = cumulativeMapForOver.get(uid) || cumulativeMapForOver.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                const overFraw = Math.max(0, Number(combined.firstPrice) - Number(cum.firstPrice));
                const overSraw = Math.max(0, Number(combined.secondPrice) - Number(cum.secondPrice));
                if (overFraw > 0 || overSraw > 0) {
                    const k = String(uid).trim();
                    const arch = archivedMapReplace.get(k) || { firstPrice: 0, secondPrice: 0 };
                    const overF = Math.max(0, overFraw - (arch.firstPrice || 0));
                    const overS = Math.max(0, overSraw - (arch.secondPrice || 0));
                    if (overF > 0 || overS > 0) {
                        computedOver.push({ uniqueId: uid, firstPrice: overF, secondPrice: overS, archived: false, locked: false, archiveId: null });
                    }
                }
            }

            // Do NOT copy archived/locked overlimit rows into a new/updated un-archived overlimit document.
            // Archives are immutable and must remain in their original documents.
            const finalOverlimitMap = new Map();

            for (const co of computedOver) {
                finalOverlimitMap.set(String(co.uniqueId).trim(), co);
            }

            // If there are any archived+locked rows across any overlimit docs, exclude those UIDs from the computedOver list
            // Ensure we don't accidentally include archived+locked rows; computed entries are non-archived.

            const finalOverlimit = Array.from(finalOverlimitMap.values());

            if (finalOverlimit.length > 0) {
                // Prefer updating an existing overlimit document that has no archived+locked rows.
                const overDocs = await Data.find({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
                let updatableDoc = null;
                for (const od of overDocs) {
                    if (!Array.isArray(od.data)) { updatableDoc = od; break; }
                    const hasArchivedLocked = od.data.some(r => r && r.archived === true && r.locked === true);
                    if (!hasArchivedLocked) { updatableDoc = od; break; }
                }
                if (updatableDoc) {
                    // Load the updatable doc and preserve any existing non-archived rows.
                    const target = await Data.findById(updatableDoc._id);
                    const existingMap = new Map();
                    if (Array.isArray(target.data)) {
                        for (const r of target.data) {
                            try {
                                const k = String(r.uniqueId).trim();
                                if (r.archived === true) continue; // do not copy archived rows
                                existingMap.set(k, { uniqueId: k, firstPrice: Number(r.firstPrice) || 0, secondPrice: Number(r.secondPrice) || 0, archived: false, locked: false, archiveId: null });
                            } catch (e) { /* ignore */ }
                        }
                    }
                    // Insert or add computed entries into existing non-archived rows (sum repeated saves)
                    for (const co of finalOverlimit) {
                        const k = String(co.uniqueId).trim();
                        const cf = Number(co.firstPrice) || 0;
                        const cs = Number(co.secondPrice) || 0;
                        // Replace stored value with computed target (do not accumulate)
                        existingMap.set(k, { uniqueId: k, firstPrice: cf, secondPrice: cs, archived: false, locked: false, archiveId: null });
                    }
                    const newDataArr = Array.from(existingMap.values());
                    await Data.findOneAndUpdate(
                        { _id: updatableDoc._id },
                        { $set: { data: newDataArr, date: draw.draw_date, ...(prizeType ? { prizeType } : {}) } },
                        { new: true }
                    );
                } else {
                    const newOver = new Data({ userId, drawId, category: 'overlimit', prizeType: prizeType || undefined, data: finalOverlimit, date: draw.draw_date });
                    await newOver.save();
                }
            }

            return res.status(200).json({ message: 'Demand replaced and overlimit updated (protected UIDs preserved)', data: existing });
        }

        if (existing) {
            // Build exact and numeric lookup maps for existing entries
            const exactMap = new Map();
            const numericMap = new Map();
            existing.data.forEach((d, i) => {
                const key = String(d.uniqueId).trim();
                exactMap.set(key, i);
                const numKey = Number(key.replace(/^0+/, '') || key);
                if (!Number.isNaN(numKey)) numericMap.set(numKey, i);
            });

            // Build lastAnalyzed map (from existing.lastAnalyzed snapshot)
            const lastAnalyzedMap = new Map();
            if (Array.isArray(existing.lastAnalyzed)) {
                existing.lastAnalyzed.forEach(a => {
                    if (!a || !a.uniqueId) return;
                    lastAnalyzedMap.set(String(a.uniqueId).trim(), { firstPrice: Number(a.firstPrice) || 0, secondPrice: Number(a.secondPrice) || 0 });
                    const numKey = Number(String(a.uniqueId).replace(/^0+/, '') || a.uniqueId);
                    if (!Number.isNaN(numKey)) lastAnalyzedMap.set(String(numKey), { firstPrice: Number(a.firstPrice) || 0, secondPrice: Number(a.secondPrice) || 0 });
                });
            }

            // Build lastCombined map (from existing.lastCombined snapshot)
            const lastCombinedMap = new Map();
            if (Array.isArray(existing.lastCombined)) {
                existing.lastCombined.forEach(a => {
                    if (!a || !a.uniqueId) return;
                    lastCombinedMap.set(String(a.uniqueId).trim(), { firstPrice: Number(a.firstPrice) || 0, secondPrice: Number(a.secondPrice) || 0 });
                    const numKey = Number(String(a.uniqueId).replace(/^0+/, '') || a.uniqueId);
                    if (!Number.isNaN(numKey)) lastCombinedMap.set(String(numKey), { firstPrice: Number(a.firstPrice) || 0, secondPrice: Number(a.secondPrice) || 0 });
                });
            }

            // We'll collect the incoming snapshot to store as new lastAnalyzed
            const incomingSnapshot = [];

            // Check whether we have a previous combined baseline
            const hasCombinedBaseline = Array.isArray(existing.lastCombined) && existing.lastCombined.length > 0;

            // For each aggregated incoming row, compute deltas based on combined totals
            if (!aggregatedEmpty) {
                for (const [uid, incoming] of aggregated.entries()) {
                    const normUid = String(uid).trim();
                    const incomingFirst = Number(incoming.firstPrice) || 0;
                    const incomingSecond = Number(incoming.secondPrice) || 0;

                    // record snapshot entry for analyzed demand
                    incomingSnapshot.push({ uniqueId: normUid, firstPrice: incomingFirst, secondPrice: incomingSecond });

                    // Find incoming combined totals for this uid
                    const combinedEntry = combinedMap.get(normUid) || (() => {
                        const numKey = String(Number(normUid.replace(/^0+/, '') || normUid));
                        return combinedMap.get(numKey) || null;
                    })();
                    const incomingCombinedFirst = combinedEntry ? Number(combinedEntry.firstPrice) || 0 : 0;
                    const incomingCombinedSecond = combinedEntry ? Number(combinedEntry.secondPrice) || 0 : 0;

                    if (!hasCombinedBaseline) {
                        // No baseline available yet — skip applying deltas for safety
                        continue;
                    }

                    // Allow applying deltas even if UID exists in archived overlimit snapshots (Option B).
                    // This ensures newly added identical numbers are recorded and later appear in overlimit snapshots.

                // find lastCombined for this uid (exact string or numeric fallback)
                    // find lastCombined for this uid (exact string or numeric fallback)
                    let lastC = lastCombinedMap.get(normUid);
                    if (!lastC) {
                        const numUid = Number(normUid.replace(/^0+/, '') || normUid);
                        if (!Number.isNaN(numUid)) lastC = lastCombinedMap.get(String(numUid));
                    }
                    const lastCombinedFirst = lastC ? Number(lastC.firstPrice) || 0 : 0;
                    const lastCombinedSecond = lastC ? Number(lastC.secondPrice) || 0 : 0;

                    // compute how much new raw total arrived since last save
                    const deltaCombinedFirst = Math.max(0, incomingCombinedFirst - lastCombinedFirst);
                    const deltaCombinedSecond = Math.max(0, incomingCombinedSecond - lastCombinedSecond);

                    // the new demand to add is at most the incoming analyzed demand and not more than the delta combined
                    const addFirst = Math.min(deltaCombinedFirst, incomingFirst);
                    const addSecond = Math.min(deltaCombinedSecond, incomingSecond);

                    if (addFirst <= 0 && addSecond <= 0) continue;

                    // match existing cumulative entry
                    let idx = -1;
                    if (exactMap.has(normUid)) idx = exactMap.get(normUid);
                    else {
                        const numUid = Number(normUid.replace(/^0+/, '') || normUid);
                        if (!Number.isNaN(numUid) && numericMap.has(numUid)) idx = numericMap.get(numUid);
                    }

                    if (idx >= 0) {
                        const existingBeforeF = Number(existing.data[idx].firstPrice) || 0;
                        const existingBeforeS = Number(existing.data[idx].secondPrice) || 0;
                        const newFirst = Math.min(existingBeforeF + (addFirst || 0), incomingCombinedFirst);
                        const newSecond = Math.min(existingBeforeS + (addSecond || 0), incomingCombinedSecond);
                        existing.data[idx].firstPrice = newFirst;
                        existing.data[idx].secondPrice = newSecond;
                        try {
                            console.log('[saveDemandRecords][diag-demand-update]', { userId, drawId, uid: normUid, lastCombinedFirst, incomingCombinedFirst, deltaCombinedFirst, incomingFirst, addFirst, existingBeforeF, existingAfterFirst: newFirst, existingBeforeS, existingAfterSecond: newSecond });
                        } catch (e) {}
                    } else {
                        existing.data.push({ uniqueId: normUid, firstPrice: addFirst || 0, secondPrice: addSecond || 0, archived: false, locked: false, archiveId: null });
                    }
                }
            }
            // If combined baseline didn't exist, initialize lastAnalyzed and lastCombined to incoming snapshots (don't apply deltas)
            if (!hasCombinedBaseline) {
                const incomingCombinedSnapshot = Array.from(combinedMap.values()).map(r => ({ uniqueId: r.uniqueId, firstPrice: r.firstPrice, secondPrice: r.secondPrice }));
                existing.lastAnalyzed = incomingSnapshot;
                existing.lastCombined = incomingCombinedSnapshot;
                try { console.log(`[saveDemandRecords] initialized baseline for user=${userId} draw=${drawId}`); } catch (e) {}
                await existing.save();
                return res.status(200).json({ message: 'Demand baseline initialized', data: existing });
            }

            // Save incoming snapshot as lastAnalyzed and update lastCombined for future delta calculations
            existing.lastAnalyzed = incomingSnapshot;
            const incomingCombinedSnapshot = Array.from(combinedMap.values()).map(r => ({ uniqueId: r.uniqueId, firstPrice: r.firstPrice, secondPrice: r.secondPrice }));
            existing.lastCombined = incomingCombinedSnapshot;

            try {
                console.log(`[saveDemandRecords] applied deltas for user=${userId} draw=${drawId} keys=[${Array.from(aggregated.keys()).join(',')}]`);
            } catch (e) {}

            await existing.save();

            // Compute overlimit snapshot from combined totals minus cumulative saved demand
            const savedDemand = existing;
            const cumulativeMap = new Map();
            for (const d of savedDemand.data) {
                const k = String(d.uniqueId).trim();
                cumulativeMap.set(k, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
                const numKey = String(Number(k.replace(/^0+/, '') || k));
                if (!cumulativeMap.has(numKey)) cumulativeMap.set(numKey, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
            }

            // Build map of archived rows across any overlimit docs (uid -> max archived amounts)
            const archivedMap = new Map();
            try {
                const overDocsAll = await Data.find({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
                for (const od of overDocsAll) {
                    if (!Array.isArray(od.data)) continue;
                    for (const r of od.data) {
                        try {
                            if (r && r.uniqueId && r.archived === true) {
                                const k = String(r.uniqueId).trim();
                                const f = Number(r.firstPrice) || 0;
                                const s = Number(r.secondPrice) || 0;
                                if (!archivedMap.has(k)) archivedMap.set(k, { firstPrice: f, secondPrice: s });
                                else {
                                    const prev = archivedMap.get(k);
                                    // keep the max archived amounts seen
                                    prev.firstPrice = Math.max(prev.firstPrice || 0, f);
                                    prev.secondPrice = Math.max(prev.secondPrice || 0, s);
                                    archivedMap.set(k, prev);
                                }
                            }
                        } catch (e) {}
                    }
                }
            } catch (e) { /* ignore */ }

            // Compute overlimit (treat identical UIDs as fresh — Option B)
            let computedOverEx = [];
            for (const [uid, combined] of combinedMap.entries()) {
                const cum = cumulativeMap.get(uid) || cumulativeMap.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                const overFraw = Math.max(0, Number(combined.firstPrice) - Number(cum.firstPrice));
                const overSraw = Math.max(0, Number(combined.secondPrice) - Number(cum.secondPrice));
                if (overFraw > 0 || overSraw > 0) {
                    const k = String(uid).trim();
                    const arch = archivedMap.get(k) || { firstPrice: 0, secondPrice: 0 };
                    const overF = Math.max(0, overFraw - (arch.firstPrice || 0));
                    const overS = Math.max(0, overSraw - (arch.secondPrice || 0));
                    if (overF > 0 || overS > 0) {
                        computedOverEx.push({ uniqueId: uid, firstPrice: overF, secondPrice: overS, archived: false, locked: false, archiveId: null });
                    }
                }
            }

            // Use only the computed (non-archived) overlimit entries when creating/updating un-archived overlimit docs
            const aggregatedOverEx = computedOverEx.map(c => ({ ...c }));

            if (aggregatedOverEx.length > 0) {
                // Prefer updating an existing overlimit document that contains NO archived rows; otherwise create a new one.
                const overDocs = await Data.find({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
                // build a quick map of archived existence by UID for diagnostics
                const archivedExist = new Set();
                for (const od of overDocs) {
                    if (!Array.isArray(od.data)) continue;
                    for (const r of od.data) {
                        try { if (r && r.uniqueId && r.archived === true) archivedExist.add(String(r.uniqueId).trim()); } catch (e) {}
                    }
                }

                // diagnostics: log per-UID values before persisting
                try {
                    const diag = aggregatedOverEx.map(e => {
                        const uid = String(e.uniqueId).trim();
                        const combinedEntry = combinedMap.get(uid) || combinedMap.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                        const cumEntry = cumulativeMapForOver.get(uid) || cumulativeMapForOver.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                        return { uid, combinedFirst: combinedEntry.firstPrice, combinedSecond: combinedEntry.secondPrice, cumulativeFirst: cumEntry.firstPrice, cumulativeSecond: cumEntry.secondPrice, computedFirst: e.firstPrice, computedSecond: e.secondPrice, archivedExists: archivedExist.has(uid) };
                    });
                    console.log('[saveDemandRecords][diag] replace-branch', { userId, drawId, diag });
                } catch (e) {}

                let updatableDoc = null;
                for (const od of overDocs) {
                    if (!Array.isArray(od.data)) { updatableDoc = od; break; }
                    const hasAnyArchived = od.data.some(r => r && r.archived === true);
                    if (!hasAnyArchived) { updatableDoc = od; break; }
                }

                if (updatableDoc) {
                    // Load target and preserve existing non-archived rows, then replace/insert computed entries
                    const target = await Data.findById(updatableDoc._id);
                    const existingMap2 = new Map();
                    if (Array.isArray(target.data)) {
                        for (const r of target.data) {
                            try {
                                const k = String(r.uniqueId).trim();
                                if (r.archived === true) continue;
                                existingMap2.set(k, { uniqueId: k, firstPrice: Number(r.firstPrice) || 0, secondPrice: Number(r.secondPrice) || 0, archived: false, locked: false, archiveId: null });
                            } catch (e) { /* ignore */ }
                        }
                    }
                    for (const co of aggregatedOverEx) {
                        const k = String(co.uniqueId).trim();
                        const cf = Number(co.firstPrice) || 0;
                        const cs = Number(co.secondPrice) || 0;
                        existingMap2.set(k, { uniqueId: k, firstPrice: cf, secondPrice: cs, archived: false, locked: false, archiveId: null });
                    }
                    const newDataArr2 = Array.from(existingMap2.values());
                    await Data.findOneAndUpdate(
                        { _id: updatableDoc._id },
                        { $set: { data: newDataArr2, date: draw.draw_date, ...(prizeType ? { prizeType } : {}) } },
                        { new: true }
                    );
                } else {
                    const newOver = new Data({ userId, drawId, category: 'overlimit', prizeType: prizeType || undefined, data: aggregatedOverEx, date: draw.draw_date });
                    await newOver.save();
                }
            }

            return res.status(200).json({ message: 'Demand records merged by delta', data: existing });
        }
        // create new demand Data doc with aggregated rows and set lastAnalyzed + lastCombined snapshots
        if (!aggregatedEmpty) {
            const initialSnapshot = Array.from(aggregated.values()).map(r => ({ uniqueId: r.uniqueId, firstPrice: r.firstPrice, secondPrice: r.secondPrice }));
            const lastCombinedSnapshot = Array.from(combinedMap.values()).map(r => ({ uniqueId: r.uniqueId, firstPrice: r.firstPrice, secondPrice: r.secondPrice }));
            const newData = new Data({ userId, drawId, category: 'demand', prizeType: prizeType || undefined, data: Array.from(aggregated.values()), lastAnalyzed: initialSnapshot, lastCombined: lastCombinedSnapshot, date: draw.draw_date });
            await newData.save();

            // Compute overlimit snapshot from combined totals minus cumulative saved demand (newData)
            const cumulativeMapNew = new Map();
            for (const d of newData.data) {
                const k = String(d.uniqueId).trim();
                cumulativeMapNew.set(k, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
                const numKey = String(Number(k.replace(/^0+/, '') || k));
                if (!cumulativeMapNew.has(numKey)) cumulativeMapNew.set(numKey, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
            }

            // Compute overlimit for unprotected UIDs and merge with any protected rows
            const computedOverNew = [];
            for (const [uid, combined] of combinedMap.entries()) {
                // Treat identical incoming UIDs as fresh entries (Option B)
                const cum = cumulativeMapNew.get(uid) || cumulativeMapNew.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                const overFraw = Math.max(0, Number(combined.firstPrice) - Number(cum.firstPrice));
                const overSraw = Math.max(0, Number(combined.secondPrice) - Number(cum.secondPrice));
                if (overFraw > 0 || overSraw > 0) {
                    const k = String(uid).trim();
                    const arch = archivedMap.get(k) || { firstPrice: 0, secondPrice: 0 };
                    const overF = Math.max(0, overFraw - (arch.firstPrice || 0));
                    const overS = Math.max(0, overSraw - (arch.secondPrice || 0));
                    if (overF > 0 || overS > 0) {
                        computedOverNew.push({ uniqueId: uid, firstPrice: overF, secondPrice: overS, archived: false, locked: false, archiveId: null });
                    }
                }
            }

            // Use only the computed (non-archived) overlimit entries when creating/updating un-archived overlimit docs
            const aggregatedOverNew = computedOverNew.map(c => ({ ...c }));

            if (aggregatedOverNew.length > 0) {
                // Prefer updating an existing overlimit document that contains NO archived rows; otherwise create a new one.
                const overDocs = await Data.find({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
                const archivedExist = new Set();
                for (const od of overDocs) {
                    if (!Array.isArray(od.data)) continue;
                    for (const r of od.data) {
                        try { if (r && r.uniqueId && r.archived === true) archivedExist.add(String(r.uniqueId).trim()); } catch (e) {}
                    }
                }
                try {
                    const diag = aggregatedOverNew.map(e => {
                        const uid = String(e.uniqueId).trim();
                        const combinedEntry = combinedMap.get(uid) || combinedMap.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                        const cumEntry = cumulativeMapNew.get(uid) || cumulativeMapNew.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                        return { uid, combinedFirst: combinedEntry.firstPrice, combinedSecond: combinedEntry.secondPrice, cumulativeFirst: cumEntry.firstPrice, cumulativeSecond: cumEntry.secondPrice, computedFirst: e.firstPrice, computedSecond: e.secondPrice, archivedExists: archivedExist.has(uid) };
                    });
                    console.log('[saveDemandRecords][diag] new-branch', { userId, drawId, diag });
                } catch (e) {}

                let updatableDoc = null;
                for (const od of overDocs) {
                    if (!Array.isArray(od.data)) { updatableDoc = od; break; }
                    const hasAnyArchived = od.data.some(r => r && r.archived === true);
                    if (!hasAnyArchived) { updatableDoc = od; break; }
                }

                if (updatableDoc) {
                    // Preserve existing non-archived rows and replace/insert computed entries
                    const target = await Data.findById(updatableDoc._id);
                    const existingMap3 = new Map();
                    if (Array.isArray(target.data)) {
                        for (const r of target.data) {
                            try {
                                const k = String(r.uniqueId).trim();
                                if (r.archived === true) continue;
                                existingMap3.set(k, { uniqueId: k, firstPrice: Number(r.firstPrice) || 0, secondPrice: Number(r.secondPrice) || 0, archived: false, locked: false, archiveId: null });
                            } catch (e) { /* ignore */ }
                        }
                    }
                    for (const co of aggregatedOverNew) {
                        const k = String(co.uniqueId).trim();
                        const cf = Number(co.firstPrice) || 0;
                        const cs = Number(co.secondPrice) || 0;
                        existingMap3.set(k, { uniqueId: k, firstPrice: cf, secondPrice: cs, archived: false, locked: false, archiveId: null });
                    }
                    const newDataArr3 = Array.from(existingMap3.values());
                    await Data.findOneAndUpdate(
                        { _id: updatableDoc._id },
                        { $set: { data: newDataArr3, date: draw.draw_date, ...(prizeType ? { prizeType } : {}) } },
                        { new: true }
                    );
                } else {
                    const newOver = new Data({ userId, drawId, category: 'overlimit', prizeType: prizeType || undefined, data: aggregatedOverNew, date: draw.draw_date });
                    await newOver.save();
                }
            }

            return res.status(201).json({ message: 'Demand records saved', data: newData });
        }

        // aggregatedEmpty === true: no demand records to persist, but update overlimit snapshot using combined totals
        // Build cumulative map from any existing demand docs for this user/draw
        const existingDemand = await Data.findOne({ userId, drawId, category: 'demand', ...(prizeType ? { prizeType } : {}) });
        const cumulativeMapForOver = new Map();
        if (existingDemand && Array.isArray(existingDemand.data)) {
            for (const d of existingDemand.data) {
                const k = String(d.uniqueId).trim();
                cumulativeMapForOver.set(k, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
                const numKey = String(Number(k.replace(/^0+/, '') || k));
                if (!cumulativeMapForOver.has(numKey)) cumulativeMapForOver.set(numKey, { firstPrice: Number(d.firstPrice) || 0, secondPrice: Number(d.secondPrice) || 0 });
            }
        }

        // Build archivedMap for fallback branch as well
        const archivedMapFallback = new Map();
        try {
            const overDocsAll2 = await Data.find({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
            for (const od of overDocsAll2) {
                if (!Array.isArray(od.data)) continue;
                for (const r of od.data) {
                    try {
                        if (r && r.uniqueId && r.archived === true) {
                            const k = String(r.uniqueId).trim();
                            const f = Number(r.firstPrice) || 0;
                            const s = Number(r.secondPrice) || 0;
                            if (!archivedMapFallback.has(k)) archivedMapFallback.set(k, { firstPrice: f, secondPrice: s });
                            else {
                                const prev = archivedMapFallback.get(k);
                                prev.firstPrice = Math.max(prev.firstPrice || 0, f);
                                prev.secondPrice = Math.max(prev.secondPrice || 0, s);
                                archivedMapFallback.set(k, prev);
                            }
                        }
                    } catch (e) {}
                }
            }
        } catch (e) { /* ignore */ }

        // Compute overlimit (treat identical UIDs as fresh — Option B)
        const computedFallback = [];
        for (const [uid, combined] of combinedMap.entries()) {
            const cum = cumulativeMapForOver.get(uid) || cumulativeMapForOver.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
            const overFraw = Math.max(0, Number(combined.firstPrice) - Number(cum.firstPrice));
            const overSraw = Math.max(0, Number(combined.secondPrice) - Number(cum.secondPrice));
            if (overFraw > 0 || overSraw > 0) {
                const k = String(uid).trim();
                const arch = archivedMapFallback.get(k) || { firstPrice: 0, secondPrice: 0 };
                const overF = Math.max(0, overFraw - (arch.firstPrice || 0));
                const overS = Math.max(0, overSraw - (arch.secondPrice || 0));
                if (overF > 0 || overS > 0) {
                    computedFallback.push({ uniqueId: uid, firstPrice: overF, secondPrice: overS, archived: false, locked: false, archiveId: null });
                }
            }
        }

        // Merge protected overlimit rows from existing overlimit doc
        // Use only the computed (non-archived) overlimit entries when updating overlimit snapshot
        const aggregatedOverFallback = computedFallback.map(c => ({ ...c }));

        if (aggregatedOverFallback.length > 0) {
            // Prefer updating an existing overlimit document that contains NO archived rows; otherwise create a new one.
            const overDocs = await Data.find({ userId, drawId, category: 'overlimit', ...(prizeType ? { prizeType } : {}) });
            const archivedExist = new Set();
            for (const od of overDocs) {
                if (!Array.isArray(od.data)) continue;
                for (const r of od.data) {
                    try { if (r && r.uniqueId && r.archived === true) archivedExist.add(String(r.uniqueId).trim()); } catch (e) {}
                }
            }
            try {
                const diag = aggregatedOverFallback.map(e => {
                    const uid = String(e.uniqueId).trim();
                    const combinedEntry = combinedMap.get(uid) || combinedMap.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                    const cumEntry = cumulativeMapForOver.get(uid) || cumulativeMapForOver.get(String(Number(uid.replace(/^0+/, '') || uid))) || { firstPrice: 0, secondPrice: 0 };
                    return { uid, combinedFirst: combinedEntry.firstPrice, combinedSecond: combinedEntry.secondPrice, cumulativeFirst: cumEntry.firstPrice, cumulativeSecond: cumEntry.secondPrice, computedFirst: e.firstPrice, computedSecond: e.secondPrice, archivedExists: archivedExist.has(uid) };
                });
                console.log('[saveDemandRecords][diag] fallback-branch', { userId, drawId, diag });
            } catch (e) {}

            let updatableDoc = null;
            for (const od of overDocs) {
                if (!Array.isArray(od.data)) { updatableDoc = od; break; }
                const hasAnyArchived = od.data.some(r => r && r.archived === true);
                if (!hasAnyArchived) { updatableDoc = od; break; }
            }

            if (updatableDoc) {
                // Preserve existing non-archived rows and replace/insert computed entries
                const target = await Data.findById(updatableDoc._id);
                const existingMap4 = new Map();
                if (Array.isArray(target.data)) {
                    for (const r of target.data) {
                        try {
                            const k = String(r.uniqueId).trim();
                            if (r.archived === true) continue;
                            existingMap4.set(k, { uniqueId: k, firstPrice: Number(r.firstPrice) || 0, secondPrice: Number(r.secondPrice) || 0, archived: false, locked: false, archiveId: null });
                        } catch (e) { /* ignore */ }
                    }
                }
                for (const co of aggregatedOverFallback) {
                    const k = String(co.uniqueId).trim();
                    const cf = Number(co.firstPrice) || 0;
                    const cs = Number(co.secondPrice) || 0;
                    existingMap4.set(k, { uniqueId: k, firstPrice: cf, secondPrice: cs, archived: false, locked: false, archiveId: null });
                }
                const newDataArr4 = Array.from(existingMap4.values());
                await Data.findOneAndUpdate(
                    { _id: updatableDoc._id },
                    { $set: { data: newDataArr4, date: draw.draw_date, ...(prizeType ? { prizeType } : {}) } },
                    { new: true }
                );
            } else {
                const newOver = new Data({ userId, drawId, category: 'overlimit', prizeType: prizeType || undefined, data: aggregatedOverFallback, date: draw.draw_date });
                await newOver.save();
            }
        }

        return res.status(200).json({ message: 'No demand deltas to persist; overlimit snapshot updated' });
    } catch (error) {
        console.error('saveDemandRecords error', error);
        return res.status(500).json({ error: error.message });
    }
}


// getDataForDate is used to get data for a specific date or slot
// and is used in the frontend to get data for a specific date or slot
const getDataForDate = async (req, res) => {   
        // Prefer drawId; legacy support for date+timeSlot removed in favour of drawId
        const { drawId, category } = req.query;

        if (!drawId) {
            return res.status(400).json({ error: "drawId is required" });
        }

        try {
            const data = await Data.find({
                userId: req.user.id,
                drawId,
                category: category || "general"
            });

            if (!data || data.length === 0) {
                return res.status(404).json({ error: "No data found for the given drawId" });
            }

            res.status(200).json({ data });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    };


const deleteDataObjectById = async (req , res) => {
    const { id } = req.params;

    if(!id){
        return res.status(400).json({ error: "Id is required" });
    }

    try {
        const data = await Data.findById(id);
        if(!data){
            return res.status(404).json({ error: "No data associated to this id" });
        }
        if (data.userId.toString() !== req.user.id) {
            return res.status(403).json({ error: "Unauthorized: You can only delete your own data" });
        }

        const refundAmount = data.data.reduce((sum, item) => {
            return sum + item.firstPrice + item.secondPrice;
        }, 0);
        console.log("Refund Amount: ", refundAmount);
        // Find the user to refund the balance
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Delete the data
        await Data.findByIdAndDelete(id);

        // Refund the amount to user's balance
        user.balance += refundAmount;
        await user.save();
        return res.status(200).json({ message: "Data deleted successfully" });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}

// In your dataController.js
const deleteIndividualEntries = async (req, res) => {
    const { entryIds } = req.body; // Array of objectIds to delete
    console.log("Entry IDs to delete:", entryIds);
    console.log("User ID:", req.user.id);
    if (!entryIds || !Array.isArray(entryIds)) {
        return res.status(400).json({ error: "Entry IDs array is required" });
    }

    try {
        let totalRefund = 0;
        const deletedEntries = [];

        // Process each entry ID
        for (const entryId of entryIds) {
            // Find the parent document containing this entry
            const parentDocument = await Data.findOne({
                "data._id": entryId,
                userId: req.user.id
            });

            if (!parentDocument) {
                continue; // Skip if not found or doesn't belong to user
            }

            // Find the specific entry to calculate refund
            const entryToDelete = parentDocument.data.find(item => item._id.toString() === entryId);
            if (entryToDelete) {
                totalRefund += entryToDelete.firstPrice + entryToDelete.secondPrice;
                deletedEntries.push(entryToDelete);
            }

            // Remove the entry from the data array
            await Data.updateOne(
                { _id: parentDocument._id },
                { $pull: { data: { _id: entryId } } }
            );

            // Check if the document has no more entries, if so delete the whole document
            const updatedDocument = await Data.findById(parentDocument._id);
            if (updatedDocument.data.length === 0) {
                await Data.findByIdAndDelete(parentDocument._id);
            }
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Refund the balance to user
        if (totalRefund > 0) {
            user.balance += totalRefund;
            await user.save();
        }

        return res.status(200).json({
            message: "Selected entries deleted successfully",
            deletedCount: deletedEntries.length,
            refundAmount: totalRefund,
            newBalance: user?.balance
        });

    } catch (error) {
        console.error("Error deleting individual entries:", error);
        return res.status(500).json({ error: error.message });
    }
};

const getAllDocuments = async (req , res) => {
    try {
        const data = await Data.find();
        if(!data){
            return res.status(404).json({ error: "No data associated to this user" });
        }
        return res.status(200).json({ data });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}

const getWinningNumbers = async (req, res) => {
    // New behaviour: winners are keyed by draw date only
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: "date is required" });
    }
    try {
        const data = await Winner.findOne({ date });
        if (!data) return res.status(404).json({ error: "No data found for the given date" });
        const winningNumbers = data.WinningNumbers.map(item => ({ number: item.number, type: item.type }));
        res.status(200).json({ winningNumbers });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const setWinningNumbers = async (req, res) => {
    // Winners are now stored per draw date (no timeSlot)
    const { date, winningNumbers } = req.body;
    if (!date || !winningNumbers || !Array.isArray(winningNumbers)) {
        return res.status(400).json({ error: "date and winningNumbers are required" });
    }
    try {
        const existingWinner = await Winner.findOne({ date });
        if (existingWinner) return res.status(400).json({ error: "Winning numbers already set for this date" });
        const newWinner = new Winner({ userId: req.user.id, date, WinningNumbers: winningNumbers.map(num => ({ number: num.number, type: num.type })) });
        await newWinner.save();
        res.status(201).json({ message: "Winning numbers set successfully", newWinner });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Update existing winning numbers for a given date
const updateWinningNumbers = async (req, res) => {
    const { date, numbers } = req.body;
    const winningNumbers = numbers || req.body.winningNumbers;

    if (!date || !winningNumbers || !Array.isArray(winningNumbers)) {
        return res.status(400).json({ error: "date and winningNumbers array are required" });
    }

    try {
        const existingWinner = await Winner.findOne({ date });
        if (!existingWinner) {
            return res.status(404).json({ error: "Winning numbers not found for this date" });
        }

        existingWinner.WinningNumbers = winningNumbers.map(num => ({ number: num.number, type: num.type }));
        await existingWinner.save();

        res.status(200).json({ success: true, message: "Winning numbers updated successfully", winner: existingWinner });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Delete winning numbers for a given date
const deleteWinningNumbers = async (req, res) => {
    const { date } = req.query;
    if (!date) {
        return res.status(400).json({ error: "date is required" });
    }

    try {
        const deleted = await Winner.findOneAndDelete({ date });
        if (!deleted) {
            return res.status(404).json({ error: "Winning numbers not found for this date" });
        }
        res.status(200).json({ success: true, message: "Winning numbers deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const getDemandOverlimit = async (req, res) => {
    const { drawId } = req.query;
    if (!drawId) return res.status(400).json({ error: "drawId is required" });
    try {
        const exists = await Data.exists({ userId: req.user.id, drawId, category: "overlimit" });
        if (!exists) return res.status(200).json({ message: "No overlimit data found for the given draw", exists: false });
        res.status(200).json({ message: "Overlimit data exists for the given draw", exists: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

const getCombinedVoucherData = async (req, res) => {
    try {
        const { drawId, category, date, timeSlot } = req.query;
        const userId = req.user.id;

        // Support two modes:
        // 1) drawId provided (preferred) - return Data documents linked to that draw
        // 2) legacy date (+ optional timeSlot) - return Data documents for that date

        let userQuery = { userId, category: category || "general" };
        let clientQuery = { category: category || "general" };

        if (drawId) {
            userQuery.drawId = drawId;
            clientQuery.drawId = drawId;
        } else if (date) {
            // Match documents whose `date` falls on the provided date (date is YYYY-MM-DD)
            const dayStart = new Date(new Date(date).toISOString().split('T')[0] + 'T00:00:00.000Z');
            const dayEnd = new Date(dayStart);
            dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
            userQuery.date = { $gte: dayStart, $lt: dayEnd };
            clientQuery.date = { $gte: dayStart, $lt: dayEnd };
            // Note: legacy `timeSlot` filtering is not stored on the new Data schema. If your
            // previous records included a timeSlot, they should be migrated to reference a Draw.
            // For now we ignore timeSlot when using date-mode.
        } else {
            return res.status(400).json({ error: "Either drawId or date is required" });
        }

        // Get user's own data
        const userEntries = await Data.find(userQuery).populate('userId', 'username dealerId');

        // Get user's clients data
        const clients = await User.find({ createdBy: userId });
        const clientIds = clients.map(client => client._id);
        clientQuery.userId = { $in: clientIds };
        const clientEntries = await Data.find(clientQuery).populate('userId', 'username dealerId');

        const allEntries = [...userEntries, ...clientEntries];

        res.status(200).json({ success: true, data: allEntries, userEntries: userEntries.length, clientEntries: clientEntries.length, totalEntries: allEntries.length, clientIds });
    } catch (error) {
        console.error("Error fetching combined voucher data:", error);
        res.status(500).json({ error: error.message });
    }
};

// Delete all demand documents for a specific user/draw/prizeType combination.
// This is used from the Emails screen to reset demand records based on filters.
const deleteDemandForClient = async (req, res) => {
    try {
        const { drawId, userId, prizeType } = req.body;
        if (!drawId || !userId) {
            return res.status(400).json({ error: 'drawId and userId are required' });
        }

        const query = { userId, drawId, category: 'demand' };
        if (prizeType) {
            query.prizeType = prizeType;
        }

        const result = await Data.deleteMany(query);
        return res.status(200).json({
            message: 'Demand records deleted successfully',
            deletedCount: result?.deletedCount || 0,
        });
    } catch (error) {
        console.error('deleteDemandForClient error', error);
        return res.status(500).json({ error: error.message });
    }
};

const getDataForClient = async (req, res) => {   
    const { drawId, category, userId, prizeType } = req.query;

        if (!drawId || !userId) return res.status(400).json({ error: "drawId and userId are required" });

        try {
            const query = { userId: userId, drawId, category: category || "general" };
            if (prizeType && category && category !== "general") {
                query.prizeType = prizeType;
            }
            const data = await Data.find(query);
            console.log("Data for client:", data);
            if (!data || data.length === 0) return res.status(404).json({ error: "No data found for the given draw and user" });
            res.status(200).json({ data });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
}; 

const checkOverlimitExists = async (req, res) => {
    const { drawId, prizeType } = req.query;
    if (!drawId) return res.status(400).json({ error: 'drawId is required' });
    const query = { userId: req.user.id, drawId, category: "overlimit" };
    if (prizeType) query.prizeType = prizeType;
    const records = await Data.find(query);
    res.json({ records });
};

export {
    addDataForTimeSlot,
    getDataForDate,
    addOverlimitData,
    saveDemandRecords,
    getDemandOverlimit,
    deleteDataObjectById,
    getAllDocuments,
    getWinningNumbers,
    setWinningNumbers,
    updateWinningNumbers,
    deleteWinningNumbers,
    deleteIndividualEntries,
    getCombinedVoucherData,
    getDataForClient,
    checkOverlimitExists,
    deleteDemandForClient
}

