// Turns a structured guide object into compact text for the model's context window.

function guideToText(guide, ageBand) {
  if (!guide) return '';
  const out = [];
  out.push(`### ${guide.name} — SafeStart curated guide`);
  if (guide.blurb) out.push(guide.blurb);
  if (guide.lastVerified) out.push(`Last verified: ${guide.lastVerified}`);
  if (guide.sourceConfidence) out.push(`Source confidence: ${guide.sourceConfidence}`);

  if (Array.isArray(guide.risks) && guide.risks.length) {
    out.push(`\nMain risks: ${guide.risks.join('; ')}`);
  }

  out.push('\nSteps:');
  (guide.steps || []).forEach((step, i) => {
    if (ageBand && Array.isArray(step.ages) && !step.ages.includes(ageBand)) return;
    const lines = [`${i + 1}. ${step.title}`];
    if (step.why) lines.push(`   Why: ${step.why}`);
    if (step.path) lines.push(`   Path: ${step.path}`);
    if (Array.isArray(step.do)) step.do.forEach((d) => lines.push(`   - ${d}`));
    if (step.recommended) {
      const rec = ageBand && step.recommended[ageBand]
        ? step.recommended[ageBand]
        : Object.entries(step.recommended).map(([k, v]) => `${k}: ${v}`).join(' | ');
      lines.push(`   Recommended${ageBand ? ` for ${ageBand}` : ''}: ${rec}`);
    }
    if (step.note) lines.push(`   Note: ${step.note}`);
    out.push(lines.join('\n'));
  });

  if (Array.isArray(guide.links) && guide.links.length) {
    out.push('\nOfficial links:');
    guide.links.forEach((l) => out.push(`- ${l.label}: ${l.url}`));
  }

  return out.join('\n');
}

module.exports = { guideToText };
