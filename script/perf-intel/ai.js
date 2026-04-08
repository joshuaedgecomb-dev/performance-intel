/**
 * ai.js — Ollama AI integration (local LLM)
 * Ported from app.jsx lines 247-433.
 *
 * Provides: ollamaGenerate, buildAIPrompt, generateNarrative, prefetchAI
 * Depends on: constants.js (AI_COLOR), engine.js (calcPacing)
 */

// ── Session-level Cache ────────────────────────────────────────────────────
// Survives tab switches, clears on page close.

var _aiCache = {};

function aiCacheKey(type, jobType, totalGoals) {
    return type + '::' + jobType + '::' + totalGoals;
}

function getAICache(type, jobType, totalGoals) {
    return _aiCache[aiCacheKey(type, jobType, totalGoals)] || null;
}

function setAICache(type, jobType, totalGoals, data) {
    _aiCache[aiCacheKey(type, jobType, totalGoals)] = data;
}

function clearAICache(type, jobType, totalGoals) {
    delete _aiCache[aiCacheKey(type, jobType, totalGoals)];
}

// ── Concurrency Limiter ────────────────────────────────────────────────────
// Ollama handles one request at a time; queue the rest.

var _aiQueue = [];
var _aiRunning = 0;
var AI_CONCURRENCY = 1;

function ollamaGenerate(prompt, model) {
    model = model || 'qwen3:8b';
    return new Promise(function(resolve) {
        var run = function() {
            _aiRunning++;
            fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    prompt: prompt,
                    stream: false,
                    options: { temperature: 0.3, num_predict: 1500 }
                })
            })
            .then(function(res) {
                if (!res.ok) { resolve(null); return null; }
                return res.json();
            })
            .then(function(data) {
                if (!data) return;
                var text = (data.response || '').trim();
                // Strip <think>...</think> reasoning tags
                text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                resolve(text || null);
            })
            .catch(function() {
                resolve(null);
            })
            .finally(function() {
                _aiRunning--;
                if (_aiQueue.length > 0) {
                    var next = _aiQueue.shift();
                    next();
                }
            });
        };

        if (_aiRunning < AI_CONCURRENCY) {
            run();
        } else {
            _aiQueue.push(run);
        }
    });
}

// ── Prompt Builder ─────────────────────────────────────────────────────────

function _aiGetMinHours() {
    var cfg = (window.PERF && window.PERF.config) || {};
    return cfg.hoursThreshold || 16;
}

function buildAIPrompt(type, data) {
    var jobType          = data.jobType || 'Business Overview';
    var uniqueAgentCount = data.uniqueAgentCount || 0;
    var totalHours       = data.totalHours || 0;
    var totalGoals       = data.totalGoals || 0;
    var gph              = data.gph || 0;
    var attainment       = data.attainment;
    var planGoals        = data.planGoals;
    var actGoals         = data.actGoals || 0;
    var distUnique       = data.distUnique || {};
    var q1Agents         = data.q1Agents || [];
    var q4Agents         = data.q4Agents || [];
    var regions          = data.regions || [];
    var healthScore      = data.healthScore;
    var totalNewXI       = data.totalNewXI || 0;
    var totalXmLines     = data.totalXmLines || 0;
    var newHiresInProgram = data.newHiresInProgram || [];
    var fiscalInfo       = data.fiscalInfo || {};
    var totalRgu         = data.totalRgu || 0;
    var sphActual        = data.sphActual || 0;
    var sphGoal          = data.sphGoal || null;

    var elapsed   = fiscalInfo.pctElapsed ? fiscalInfo.pctElapsed.toFixed(1) + '%' : 'unknown';
    var daysLeft  = fiscalInfo.remainingBDays !== undefined ? fiscalInfo.remainingBDays : 'unknown';
    var elapsedDays = fiscalInfo.elapsedBDays || 0;
    var totalDays   = fiscalInfo.totalBDays || 0;

    // Pacing analysis
    var pacingStr = 'unknown';
    var projectedHomes = null, requiredDaily = null, currentDaily = null;
    if (fiscalInfo && attainment !== null && attainment !== undefined && fiscalInfo.pctElapsed > 0 && planGoals) {
        var pace = calcPacing(actGoals, planGoals, fiscalInfo.elapsedBDays, fiscalInfo.totalBDays);
        if (pace) {
            pacingStr = pace.projectedPct >= 100 ? 'AHEAD of pace' : pace.projectedPct >= 85 ? 'NEAR pace' : 'BEHIND pace';
            projectedHomes = pace.projected;
            requiredDaily = pace.requiredDaily;
            currentDaily = pace.dailyRate;
        }
    }

    // Agent breakdown
    var totalAgents = uniqueAgentCount || 0;
    var q1n = distUnique.Q1 || 0, q2n = distUnique.Q2 || 0, q3n = distUnique.Q3 || 0, q4n = distUnique.Q4 || 0;
    var q1pct = totalAgents > 0 ? Math.round((q1n / totalAgents) * 100) : 0;
    var q4pct = totalAgents > 0 ? Math.round((q4n / totalAgents) * 100) : 0;

    var minHours = _aiGetMinHours();

    // Top performers
    var topPerf = q1Agents.filter(function(a) { return a.hours >= minHours; }).slice(0, 5)
        .map(function(a) {
            return a.agentName + ': ' + a.goals + ' sales, ' + (a.hours || 0).toFixed(0) + 'hrs, ' +
                (a.goals / Math.max(a.hours, 1)).toFixed(3) + ' GPH, ' + Math.round(a.pctToGoal || 0) + '% to goal';
        }).join('\n  ');

    // Risk agents
    var riskAgents = q4Agents.filter(function(a) { return a.hours >= minHours; }).slice(0, 5)
        .map(function(a) {
            return a.agentName + ': ' + a.goals + ' sales, ' + (a.hours || 0).toFixed(0) + 'hrs, ' + (a.region || 'unknown') + ' site';
        }).join('\n  ');

    // Q3 bubble agents close to Q2
    var q3Agents = data.q3Agents || [];
    var bubbleAgents = q3Agents.filter(function(a) { return a.hours >= minHours && a.pctToGoal >= 60; }).slice(0, 3)
        .map(function(a) { return a.agentName + ': ' + Math.round(a.pctToGoal) + '% to goal, ' + (a.hours || 0).toFixed(0) + 'hrs'; }).join('; ');

    // Site comparison
    var siteData = regions.map(function(r) {
        var gap = r.avgPct !== undefined ? Math.round(r.avgPct) + '% avg to goal' : '';
        return r.name + ': ' + (r.count || '?') + ' agents, ' + gap;
    }).join('\n  ');

    // New hires
    var nhList = newHiresInProgram.slice(0, 5).map(function(a) {
        return a.agentName + ': ' + (a.quartile || '?') + ', ' + ((a.hours || 0).toFixed(0)) + 'hrs, ' + (a.goals || 0) + ' sales';
    }).join('; ');

    // Product mix
    var productMix = [];
    if (totalNewXI)   productMix.push('HSD: ' + totalNewXI);
    if (totalXmLines) productMix.push('XM: ' + totalXmLines);
    if (totalRgu)     productMix.push('RGU: ' + totalRgu);
    var hsdPerSale = totalGoals > 0 && totalNewXI ? (totalNewXI / totalGoals).toFixed(2) : null;
    var xmPerSale  = totalGoals > 0 && totalXmLines ? (totalXmLines / totalGoals).toFixed(2) : null;

    var context = 'PROGRAM: ' + jobType + '\n' +
        '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n' +
        'WORKFORCE: ' + totalAgents + ' agents | ' + (totalHours ? totalHours.toFixed(0) : '0') + ' total hours | ' + (totalGoals || 0) + ' total sales | ' + (gph ? gph.toFixed(3) : '0') + ' GPH\n' +
        'GOAL: ' + (actGoals || 0) + ' of ' + (planGoals || 'no plan') + ' homes | Attainment: ' + (attainment !== null && attainment !== undefined ? Math.round(attainment) + '%' : 'N/A') + '\n' +
        (sphActual ? 'SPH: ' + sphActual.toFixed(3) + ' actual vs ' + (sphGoal ? sphGoal.toFixed(3) : '?') + ' goal\n' : '') +
        '\nPACING (day ' + elapsedDays + ' of ' + totalDays + ', month ' + elapsed + ' elapsed, ' + daysLeft + ' biz days left):\n' +
        '  Status: ' + pacingStr + '\n' +
        '  Current daily rate: ' + (currentDaily ? currentDaily.toFixed(1) : '?') + ' homes/day\n' +
        '  Required daily rate: ' + (requiredDaily ? requiredDaily.toFixed(1) : '?') + ' homes/day\n' +
        '  Projected EOM: ' + (projectedHomes !== null ? projectedHomes + ' homes' : 'N/A') + '\n' +
        '\nQUARTILE DISTRIBUTION:\n' +
        '  Q1 (\u2265100%): ' + q1n + ' agents (' + q1pct + '% of workforce)\n' +
        '  Q2 (80-99%): ' + q2n + ' agents\n' +
        '  Q3 (1-79%): ' + q3n + ' agents\n' +
        '  Q4 (0%): ' + q4n + ' agents (' + q4pct + '% of workforce)\n' +
        '  Health Score: ' + (healthScore ? Math.round(healthScore) : 'N/A') + '/100\n' +
        '\nTOP PERFORMERS (Q1, ' + minHours + '+ hrs):\n' +
        '  ' + (topPerf || 'None yet') + '\n' +
        '\nRISK AGENTS (Q4, ' + minHours + '+ hrs, zero sales):\n' +
        '  ' + (riskAgents || 'None') + '\n' +
        (bubbleAgents ? '\nBUBBLE AGENTS (Q3, close to Q2 threshold):\n  ' + bubbleAgents + '\n' : '') +
        '\nSITES:\n' +
        '  ' + (siteData || 'Single site') + '\n' +
        (newHiresInProgram.length > 0 ? '\nNEW HIRES (' + newHiresInProgram.length + '):\n  ' + nhList + '\n' : '') +
        '\nPRODUCT MIX: ' + (productMix.join(' | ') || 'N/A') +
        (hsdPerSale ? '\n  HSD/sale: ' + hsdPerSale : '') +
        (xmPerSale ? ' | XM/sale: ' + xmPerSale : '');

    var sysPrompt = '/no_think\nYou are a senior telesales operations analyst at a cable/telecom company. You analyze agent performance data for door-to-door and telesales programs selling Xfinity services (internet/HSD, mobile, video, phone). Your audience is the program manager who makes daily coaching decisions.\n\nRULES:\n- Every claim must reference a specific number from the data\n- Name specific agents when relevant\n- Compare rates and ratios, not just raw counts\n- Identify the WHY behind patterns, not just the WHAT\n- Be direct \u2014 no filler phrases like "it\'s worth noting" or "interestingly"\n- No markdown formatting, no bullet points, no headers\n';

    if (type === 'narrative') {
        return sysPrompt + '\nWrite a 4-6 paragraph executive summary. Start with pacing status and projected finish. Then cover workforce composition and what the quartile distribution signals. Address specific coaching priorities by agent name. End with the single most impactful action for the remaining ' + daysLeft + ' business days.\n\nData:\n' + context;
    }
    if (type === 'wins') {
        return sysPrompt + '\nIdentify 3-5 specific wins from this data. Each must name an agent, a number, or a rate. Focus on: conversion efficiency, pacing momentum, product mix strength, new hire ramp speed, or site-level standouts. One sentence per win. No generic praise.\n\nData:\n' + context + '\n\nWins (one per line):';
    }
    if (type === 'opps') {
        return sysPrompt + '\nIdentify 3-5 specific opportunities. Each must name an agent or a gap, and prescribe a concrete next-day action (not "consider" or "review" \u2014 tell the manager exactly what to do). Focus on: Q4 agents with hours, Q3 agents near Q2 threshold, product attach gaps, site parity issues, pacing shortfalls. One sentence per opportunity.\n\nData:\n' + context + '\n\nOpportunities (one per line):';
    }

    // MoM comparison
    if (data.prevGoals !== undefined) {
        var momCtx = '\nMONTH-OVER-MONTH COMPARISON:\n' +
            '  Prior month agents: ' + (data.prevAgents || '?') + '  |  Current month agents: ' + (data.uniqueAgentCount || '?') + '\n' +
            '  Prior month sales: ' + (data.prevGoals || 0) + '  |  Current month sales: ' + (data.totalGoals || 0) + '  (' + ((data.totalGoals || 0) - (data.prevGoals || 0) >= 0 ? '+' : '') + ((data.totalGoals || 0) - (data.prevGoals || 0)) + ')\n' +
            '  Prior month hours: ' + (data.prevHours ? data.prevHours.toFixed(0) : '?') + '  |  Current month hours: ' + (data.totalHours ? data.totalHours.toFixed(0) : '?') + '\n' +
            '  Prior GPH: ' + (data.prevGph ? data.prevGph.toFixed(3) : '?') + '  |  Current GPH: ' + (data.gph ? data.gph.toFixed(3) : '?') + '\n' +
            '  Avg delta % to goal: ' + (data.avgDelta !== undefined ? (data.avgDelta >= 0 ? '+' : '') + data.avgDelta.toFixed(1) + '%' : '?') + '\n' +
            '  Agents improved: ' + (data.improvedCount || 0) + '  |  Agents declined: ' + (data.declinedCount || 0) + '\n' +
            '  Top improvers: ' + ((data.topMovers || []).filter(function(a) { return a.delta > 0; }).slice(0, 3).map(function(a) { return a.name + ' (+' + a.delta.toFixed(1) + '%)'; }).join(', ') || 'none') + '\n' +
            '  Biggest declines: ' + ((data.bottomMovers || []).filter(function(a) { return a.delta < 0; }).slice(0, 3).map(function(a) { return a.name + ' (' + a.delta.toFixed(1) + '%)'; }).join(', ') || 'none');
        return sysPrompt + '\nWrite a 4-6 paragraph month-over-month executive summary. Compare prior vs current month performance. Identify what changed and why \u2014 agent count shifts, conversion rate changes, hours utilization. Name specific agents who drove improvement or decline. Assess whether the trend is sustainable. End with 1-2 specific actions for the program manager.\n\nData:\n' + context + momCtx;
    }

    // Business overview (default)
    return sysPrompt + '\nWrite a 4-6 paragraph business-wide executive summary for leadership. Cover: overall pacing and projected finish across all programs, which programs are driving vs dragging performance, workforce utilization (agents with hours vs at threshold), and the top 2-3 actions that would move the needle most in the remaining ' + daysLeft + ' business days.\n\nData:\n' + context;
}

// ── Generate Narrative (with caching and parsing) ──────────────────────────

function generateNarrative(type, data, callback) {
    var cached = getAICache(type, data.jobType, data.totalGoals);
    if (cached) {
        callback(cached);
        return;
    }

    var prompt = buildAIPrompt(type, data);
    ollamaGenerate(prompt).then(function(result) {
        if (!result) {
            callback(null);
            return;
        }

        var parsed;
        if (type === 'narrative') {
            parsed = result.split(/\n\n+/).filter(function(l) { return l.trim(); });
        } else {
            // wins, opps — split by line, strip bullet prefixes
            parsed = result.split(/\n/).filter(function(l) { return l.trim(); })
                .map(function(l) { return l.replace(/^[\d\-\.\*\)]+\s*/, '').trim(); })
                .filter(Boolean);
        }

        setAICache(type, data.jobType, data.totalGoals, parsed);
        callback(parsed);
    });
}

// ── AI Prefetch Engine ─────────────────────────────────────────────────────
// Fires all AI generations at once when local AI is toggled on.
// Results land in _aiCache; UI components read from cache.

function prefetchAI(promptDataList) {
    var tasks = [];
    for (var i = 0; i < promptDataList.length; i++) {
        var item = promptDataList[i];
        var type = item.type;
        var data = item.data;
        var key = aiCacheKey(type, data.jobType, data.totalGoals);
        if (_aiCache[key]) continue; // already cached

        var prompt = buildAIPrompt(type, data);
        // Use an IIFE to capture type/data in closure
        var task = (function(t, d) {
            return ollamaGenerate(prompt).then(function(result) {
                if (result) {
                    if (t === 'narrative') {
                        setAICache(t, d.jobType, d.totalGoals, result.split(/\n\n+/).filter(function(l) { return l.trim(); }));
                    } else {
                        var items = result.split(/\n/).filter(function(l) { return l.trim(); })
                            .map(function(l) { return l.replace(/^[\d\-\.\*\)]+\s*/, '').trim(); })
                            .filter(Boolean);
                        setAICache(t, d.jobType, d.totalGoals, items);
                    }
                }
            });
        })(type, data);
        tasks.push(task);
    }
    return tasks;
}
