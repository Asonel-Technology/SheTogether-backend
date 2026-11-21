/**
 * User-facing chatbot strings. IMPORTANT: safety/urgent texts for rw, sw, fr and ar must be reviewed by
 * native speakers and safeguarding/clinical experts before launch.
 */
export const LANGUAGE_NAMES = { en: 'English', rw: 'Kinyarwanda', sw: 'Kiswahili', fr: 'French', ar: 'Arabic' };

export const URGENT = {
  SELF_HARM: {
    en: "I'm really sorry you are feeling this much pain. You are not alone and help is available. If you might act on these thoughts or you are in danger right now, please call the emergency number below or go to the nearest health facility immediately. Talking to a trusted adult, a friend or a counsellor can also help. I am an information assistant and cannot give emergency support.",
    fr: "Je suis vraiment désolé que tu ressentes autant de douleur. Tu n'es pas seul(e) et de l'aide existe. Si tu risques de passer à l'acte ou si tu es en danger maintenant, appelle le numéro d'urgence ci-dessous ou rends-toi immédiatement au centre de santé le plus proche. Parler à un adulte de confiance, à un(e) ami(e) ou à un conseiller peut aussi aider. Je suis un assistant d'information et je ne peux pas fournir une aide d'urgence.",
    sw: 'Pole sana kwa maumivu unayohisi. Hauko peke yako na msaada upo. Ikiwa unaweza kujidhuru au uko hatarini sasa hivi, tafadhali piga namba ya dharura iliyo hapa chini au nenda kituo cha afya kilicho karibu mara moja. Kuzungumza na mtu mzima unayemwamini, rafiki au mshauri kunaweza pia kusaidia. Mimi ni msaidizi wa taarifa tu na siwezi kutoa msaada wa dharura.',
    rw: "Mbabajwe cyane n'uko ubabaye ku rugero rungana rutyo. Ntabwo uri wenyine kandi ubufasha burahari. Niba ushobora gukora ibyo utekereza cyangwa uri mu kaga ubu, hamagara nimero y'ubutabazi iri hasi cyangwa ujye ku kigo nderabuzima kikwegereye ako kanya. Kuganira n'umuntu mukuru wizeye, inshuti cyangwa umujyanama na byo bishobora kugufasha. Ndi umufasha utanga amakuru gusa, sinshobora gutanga ubutabazi bwihuse.",
    ar: 'يؤسفني أنك تشعر بهذا الألم. لست وحدك وهناك من يساعدك. إذا كنت قد تؤذي نفسك أو كنت في خطر الآن، فاتصل برقم الطوارئ أدناه أو توجه فورًا إلى أقرب مرفق صحي. التحدث مع شخص بالغ تثق به أو صديق أو مستشار قد يساعدك أيضًا. أنا مساعد معلوماتي ولا أستطيع تقديم دعم طارئ.',
  },
  ABUSE: {
    en: 'I am sorry this is happening. It is not your fault and you deserve to be safe. If you are in danger now, call the emergency number below. You can get free, confidential help from an Isange One Stop Centre or the helplines below. If you can, go to a safe place or to a trusted adult. I am an information assistant and cannot give emergency support.',
    fr: "Je suis désolé que cela t'arrive. Ce n'est pas ta faute et tu mérites d'être en sécurité. Si tu es en danger maintenant, appelle le numéro d'urgence ci-dessous. Tu peux obtenir une aide gratuite et confidentielle dans un centre Isange One Stop ou via les lignes d'assistance ci-dessous. Si possible, rends-toi dans un endroit sûr ou auprès d'un adulte de confiance. Je suis un assistant d'information et je ne peux pas fournir une aide d'urgence.",
    sw: 'Pole kwa yanayokupata. Si kosa lako na unastahili kuwa salama. Ikiwa uko hatarini sasa hivi, piga namba ya dharura iliyo hapa chini. Unaweza kupata msaada wa bure na wa siri kutoka Isange One Stop Centre au namba za msaada zilizo hapa chini. Ikiwezekana, nenda mahali salama au kwa mtu mzima unayemwamini. Mimi ni msaidizi wa taarifa tu na siwezi kutoa msaada wa dharura.',
    rw: "Mbabajwe n'ibikubayeho. Si wowe nyirabayazana kandi ukwiye kurindwa. Niba uri mu kaga ubu, hamagara nimero y'ubutabazi iri hasi. Ushobora kubona ubufasha bw'ubuntu kandi bwa banga muri Isange One Stop Centre cyangwa kuri nimero z'ubufasha ziri hasi. Niba bishoboka, jya ahantu hizewe cyangwa ushake umuntu mukuru wizeye. Ndi umufasha utanga amakuru gusa, sinshobora gutanga ubutabazi bwihuse.",
    ar: 'أنا آسف لما يحدث لك. هذا ليس ذنبك وتستحق أن تكون آمنًا. إذا كنت في خطر الآن فاتصل برقم الطوارئ أدناه. يمكنك الحصول على مساعدة مجانية وسرية من خلال الخطوط والمراكز المذكورة أدناه. إن أمكن، انتقل إلى مكان آمن أو إلى شخص بالغ تثق به. أنا مساعد معلوماتي ولا أستطيع تقديم دعم طارئ.',
  },
  MEDICAL: {
    en: 'What you describe may need urgent medical attention. Please go to the nearest health facility or call the emergency number below right away, and ask someone to go with you. I am an information assistant and cannot assess symptoms or give emergency care.',
    fr: "Ce que tu décris peut nécessiter une prise en charge médicale urgente. Rends-toi tout de suite au centre de santé le plus proche ou appelle le numéro d'urgence ci-dessous, et demande à quelqu'un de t'accompagner. Je suis un assistant d'information et je ne peux ni évaluer des symptômes ni fournir des soins d'urgence.",
    sw: 'Unachoeleza kinaweza kuhitaji huduma ya kitabibu ya haraka. Tafadhali nenda kituo cha afya kilicho karibu au piga namba ya dharura iliyo hapa chini mara moja, na umwombe mtu aende nawe. Mimi ni msaidizi wa taarifa tu na siwezi kutathmini dalili wala kutoa huduma ya dharura.',
    rw: "Ibyo uvuga bishobora gusaba ubuvuzi bwihuse. Jya ku kigo nderabuzima kikwegereye cyangwa uhamagare nimero y'ubutabazi iri hasi ako kanya, usabe umuntu ukujyana. Ndi umufasha utanga amakuru gusa, sinshobora gusuzuma ibimenyetso cyangwa gutanga ubutabazi bwihuse.",
    ar: 'ما تصفه قد يحتاج إلى عناية طبية عاجلة. يرجى التوجه إلى أقرب مرفق صحي أو الاتصال برقم الطوارئ أدناه فورًا، واطلب من أحد مرافقتك. أنا مساعد معلوماتي ولا أستطيع تقييم الأعراض أو تقديم رعاية طارئة.',
  },
};

export const INSUFFICIENT = {
  en: "I don't have enough reviewed information to answer that safely. Please talk to a health worker, or use the services listed below for a reliable answer.",
  fr: "Je n'ai pas assez d'informations vérifiées pour répondre en toute sécurité. Parle à un professionnel de santé ou utilise les services indiqués ci-dessous.",
  sw: 'Sina taarifa za kutosha zilizohakikiwa ili kujibu kwa usalama. Tafadhali zungumza na mhudumu wa afya au tumia huduma zilizoorodheshwa hapa chini.',
  rw: "Nta makuru ahagije yemejwe mfite yo gusubiza ibyo mu buryo butekanye. Baza umukozi w'ubuzima cyangwa ukoreshe serivisi ziri hasi.",
  ar: 'لا أملك معلومات موثوقة كافية للإجابة بأمان. يرجى التحدث مع مختص صحي أو استخدام الخدمات المذكورة أدناه.',
};
export const OUT_OF_SCOPE = {
  en: 'I can only help with puberty, menstrual and reproductive health, hygiene, consent, healthy relationships and staying safe. Is there something about these topics I can help with?',
  fr: "Je peux seulement t'aider sur la puberté, la santé menstruelle et reproductive, l'hygiène, le consentement, les relations saines et la sécurité. Y a-t-il un sujet de ce type sur lequel je peux t'aider ?",
  sw: 'Naweza kusaidia tu kuhusu balehe, afya ya hedhi na uzazi, usafi, ridhaa, mahusiano mazuri na usalama. Je, kuna jambo kuhusu mada hizi ninaloweza kukusaidia?',
  rw: "Nshobora gufasha gusa ku bijyanye no kuba ingimbi/umwangavu, ubuzima bw'imihango n'imyororokere, isuku, kubyemera, ubusabane bwiza no kwirinda ibyago. Hari icyo kuri ibyo nagufasha?",
  ar: 'يمكنني المساعدة فقط في مواضيع البلوغ والصحة الإنجابية والدورة الشهرية والنظافة والموافقة والعلاقات الصحية والسلامة. هل هناك ما يخص هذه المواضيع أستطيع مساعدتك فيه؟',
};
export const AI_DOWN = {
  en: 'The assistant is temporarily unavailable. Please try again soon, or use the services listed below.',
  fr: "L'assistant est momentanément indisponible. Réessaie bientôt ou utilise les services indiqués ci-dessous.",
  sw: 'Msaidizi hapatikani kwa muda. Tafadhali jaribu tena baadaye au tumia huduma zilizoorodheshwa hapa chini.',
  rw: "Umufasha ntabonetse by'agateganyo. Ongera ugerageze nyuma cyangwa ukoreshe serivisi ziri hasi.",
  ar: 'المساعد غير متاح مؤقتًا. يرجى المحاولة لاحقًا أو استخدام الخدمات المذكورة أدناه.',
};
export const DISCLAIMER = {
  en: 'This assistant gives general information only. It is not a health professional and this is not medical advice.',
  fr: "Cet assistant donne uniquement des informations générales. Il n'est pas un professionnel de santé et ceci n'est pas un avis médical.",
  sw: 'Msaidizi huyu anatoa taarifa za jumla tu. Si mtaalamu wa afya na hii si ushauri wa kitabibu.',
  rw: "Uyu mufasha atanga amakuru rusange gusa. Si umuganga kandi ibi si inama y'ubuvuzi.",
  ar: 'يقدم هذا المساعد معلومات عامة فقط. وهو ليس مختصًا صحيًا وهذه ليست نصيحة طبية.',
};
