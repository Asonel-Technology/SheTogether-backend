/**
 * Rule-based safety screen that runs BEFORE any AI call. URGENT messages never reach the model:
 * the user gets escalation guidance + emergency contacts immediately.
 * Keyword lists are a conservative starting point (false positives are acceptable, false negatives are not)
 * and MUST be extended/reviewed with clinical, safeguarding and native-speaker experts.
 */
const P = (...src) => src.map((s) => new RegExp(s, 'iu'));

const URGENT_RULES = {
  SELF_HARM: P(
    String.raw`\b(kill myself|want to die|wanna die|end my life|suicid\w*|self[- ]?harm\w*|hurt myself|cut myself|better off dead)\b`,
    String.raw`\b(me tuer|veux mourir|suicid\w*|me faire du mal|mettre fin à (mes|ma) (jours|vie))`,
    String.raw`(kujiua|nataka kufa|kujidhuru|kujiumiza|nimechoka kuishi)`,
    String.raw`(kwiyahura|ndashaka gupfa|kwiyica|kwikomeretsa)`,
    String.raw`(انتحار|أنتحر|أريد أن أموت|أقتل نفسي|أؤذي نفسي|أريد إنهاء حياتي)`,
  ),
  ABUSE: P(
    String.raw`\b(rape[ds]?|raping|sexual(ly)? (assault|abus)\w*|molest\w*|forced me|forcing me|being abused|abus(es|ing) me|beat(s|ing)? me|hit(s|ting)? me|touch(es|ed|ing) me (without|against)|incest)\b`,
    String.raw`\b(viol(ée|ee|er|é)?|agress\w+ sexuel\w*|abus(e|é)\w* (de )?moi|me force|il me frappe|elle me frappe|inceste)\b`,
    String.raw`(nimebakwa|ananibaka|kubakwa|ubakaji|ananinyanyasa|ananipiga|unyanyasaji wa kingono|ananilazimisha)`,
    String.raw`(nafashwe ku ngufu|bampohoza|yamfashe ku ngufu|gufata ku ngufu|ndahohoterwa|ahora ankubita|bandyamo)`,
    String.raw`(اغتصاب|اغتصبني|يغتصبني|تحرش جنسي|يضربني|يعتدي علي|اعتداء جنسي)`,
  ),
  MEDICAL: P(
    String.raw`\b(heavy bleeding|bleeding (a lot|heavily|badly|non[- ]?stop)|(can'?t|cannot|won'?t) stop bleeding|soaking (through )?(a |one )?pad|severe (abdominal|stomach|belly|pelvic) pain|passed out|collaps\w+|overdos\w+|swallowed (poison|pills)|can'?t breathe)\b`,
    String.raw`\b(saignement (abondant|important)|hémorragie|saigne beaucoup|douleur (intense|forte|insupportable) (au|dans le) ventre|évanou\w+|overdose)\b`,
    String.raw`(damu nyingi|kutokwa na damu nyingi|maumivu makali ya tumbo|nimeanguka|nimezimia)`,
    String.raw`(amaraso menshi|kuva amaraso menshi|kubabara cyane munda|ndacitse intege cyane)`,
    String.raw`(نزيف شديد|نزيف حاد|ألم شديد في البطن|أغمي علي)`,
  ),
};

// Topics that usually need a clinician: the answer is still given from reviewed content, but professional support is recommended.
const SENSITIVE = P(
  String.raw`\b(pregnan\w*|abortion|miscarriage|hiv|aids|sti|std|infection|discharge|itch\w*|pain\w*|bleeding|period (late|missed)|missed period|medicine|medication|pills?|contracepti\w+|condom)\b`,
  String.raw`\b(enceinte|grossesse|avortement|vih|sida|ist|infection|douleur|saignement|règles? (en retard|absentes)|médicament|pilule|contracepti\w+|préservatif)\b`,
  String.raw`(mimba|ujauzito|kuharibika|ukimwi|vvu|maambukizi|maumivu|damu|dawa|vidonge|kondomu)`,
  String.raw`(inda|gutwita|gukuramo inda|sida|virusi itera sida|indwara|kubabara|amaraso|imiti|agakingirizo)`,
  String.raw`(حمل|إجهاض|إيدز|التهاب|ألم|نزيف|دواء|حبوب|عازل)`,
);

export function assessRisk(text) {
  for (const [category, rules] of Object.entries(URGENT_RULES)) {
    if (rules.some((r) => r.test(text))) return { level: 'URGENT', category };
  }
  if (SENSITIVE.some((r) => r.test(text))) return { level: 'SENSITIVE', category: null };
  return { level: 'NONE', category: null };
}
export const maxLevel = (a, b) => (['NONE', 'SENSITIVE', 'URGENT'].indexOf(b) > ['NONE', 'SENSITIVE', 'URGENT'].indexOf(a) ? b : a);
