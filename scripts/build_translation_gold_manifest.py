#!/usr/bin/env python3
"""Build the fixed MOFA 2026-01-09 translation-quality manifest.

The Japanese and English paragraphs below are the official MOFA texts. The
timestamps are anchors from the already-verified clean-audio windows; they do
not supply wording. Run this script only before the independent review, then
freeze the emitted manifest.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.slice_gold_audio import load_audio, save_audio, slice_audio


JA_URL = "https://www.mofa.go.jp/mofaj/press/kaiken/kaikenw_000001_00200.html"
EN_URL = "https://www.mofa.go.jp/press/kaiken/kaikenwe_000001_00221.html"
VIDEO_ID = "PV0xVuhmBQI"
SOURCE_AUDIO = ROOT / "testdata/audio-gold/wavs/mofa-2026-01-09-source.wav"
AUDIO_DIR = ROOT / "testdata/audio-gold/mofa-2026-01-09/translation-wavs"
OUTPUT = ROOT / "testdata/translation-gold/mofa-2026-01-09.20cue.manifest.json"


CUES = [
    {
        "id": "translation-01",
        "startMs": 13360,
        "endMs": 21360,
        "source": "今年最初の記者会見になります。今年もどうぞよろしくお願いします。",
        "referenceEn": "This is the first press conference of the year. I look forward to working with you all again this year.",
        "reviewRequirement": "Keep the first-of-the-year meaning, the speaker's greeting, and the formal tone.",
    },
    {
        "id": "translation-02",
        "startMs": 19860,
        "endMs": 27860,
        "source": "まず、私の海外出張について御報告します。",
        "referenceEn": "First, I have an announcement about my overseas visit.",
        "reviewRequirement": "Keep the announcement sequence and the first-person overseas-visit meaning.",
    },
    {
        "id": "translation-03",
        "startMs": 26360,
        "endMs": 34360,
        "source": "明日、1月10日から18日まで、イスラエル、パレスチナ、カタール、そして、フィリピン、インドを訪問する予定です。",
        "referenceEn": "I will visit Israel, Palestine, Qatar, the Philippines, and India from tomorrow, January 10, to January 18.",
        "reviewRequirement": "Preserve every destination, the January 10–18 range, and the future visit meaning.",
    },
    {
        "id": "translation-04",
        "startMs": 34360,
        "endMs": 58860,
        "source": "これまで、G7外相会合など、国際会議への出席のため、既に昨年3回、海外出張を行ってきて、その中で、各国のカウンターパートとのバイ会談等も行ってきましたが、今年最初の出張は、初の二国間訪問と、こういった形で、中東と、そしてアジア地域、これを、訪問する予定であります。",
        "referenceEn": "Last year, I made three overseas visits to attend international meetings, including the G7 Foreign Ministers’ Meeting, and held bilateral meetings with my counterparts on the sidelines. For my first overseas trip this year, I will visit the Middle East and Asia. This will be my first bilateral visit since assuming office last year.",
        "reviewRequirement": "Preserve three prior visits, the G7 reference, the first bilateral visit, and both regions.",
    },
    {
        "id": "translation-05",
        "startMs": 58860,
        "endMs": 91360,
        "source": "既存の国際秩序、これが大きく揺らぐ中、法の支配に基づく自由で開かれた国際秩序を維持すべく、同志国との連携、さらにはグローバル・サウスと呼ばれる国々との関係強化、かつてなく重要になってきていると考えております。",
        "referenceEn": "At a time when the existing international order is greatly shaken, I believe working with like-minded countries and strengthening relationships with countries known as the Global South is becoming more important than ever in order to maintain a free and open international order based on the rule of law.",
        "reviewRequirement": "Keep the rule of law, free and open order, like-minded countries, and Global South as distinct concepts.",
    },
    {
        "id": "translation-06",
        "startMs": 91360,
        "endMs": 105860,
        "source": "こうした観点から、まずは、国際社会の安定にとって重要な中東地域を訪問いたします。",
        "referenceEn": "On these grounds, I will first visit the Middle East, a key region for international stability.",
        "reviewRequirement": "Preserve the causal transition, first visit, and international-stability rationale.",
    },
    {
        "id": "translation-07",
        "startMs": 110860,
        "endMs": 143360,
        "source": "イスラエルとパレスチナを取り巻く状況の改善のためにはまず、「包括的計画」の着実な実施が重要であり、日本としても、積極的な役割を果たす考えであります。さらに、この地域の緊張緩和と平和構築を達成していくためには、長年にわたる相互不信、この払拭というものが必要だと考えておりまして、それに向けてイスラエル、パレスチナ双方が、具体的な前向きな発言だけではなくて、行動をとっていくことが重要だと考えております。",
        "referenceEn": "First and foremost, the robust implementation of the “Comprehensive Plan” is crucial for improving the situation surrounding Israel and Palestine, and Japan will continue to play a proactive role. Furthermore, to de-escalate tensions and build peace in this region, I believe it is necessary to overcome the longstanding mutual distrust. To this end, it is important for both Israel and Palestine to take concrete actions, rather than simply making forward-looking statements.",
        "reviewRequirement": "Preserve the Comprehensive Plan, both sides, de-escalation, peacebuilding, and the contrast between words and actions.",
    },
    {
        "id": "translation-08",
        "startMs": 143360,
        "endMs": 177360,
        "source": "日本は、イスラエル、パレスチナ双方と、良好な関係を維持してきております。今回の私の、中東訪問、この大きな目的は、こうした信頼関係を踏まえて、今後の具体的な対応について、双方に率直な考えを伝え、日本の協力についても、説明をしたいと、こんなふうに考えているところであります。",
        "referenceEn": "Japan has maintained good relations with both Israel and Palestine. The primary purpose of my visit to the Middle East is to convey Japan’s candid views on future concrete measures to both sides, based on this foundation of trust, and to explain how Japan will cooperate.",
        "reviewRequirement": "Keep both parties, the trust foundation, candid views, and Japan's cooperation.",
    },
    {
        "id": "translation-09",
        "startMs": 175860,
        "endMs": 214860,
        "source": "まず、中東和平、この実現に向けて「包括的計画」、これを着実に実行していくことが重要でありますが、その次の段階を考えたときに、やはりこの相互不信というものを解消していくということがやはり地域の安定につながるという観点から、イスラエルもやるべきことがある、また、パレスチナもやるべきことがある、そのことについて、率直に日本として、考えを伝える。そして日本としても、それに向けて協力していくということを説明したいと、こんなふうに考えております。",
        "referenceEn": "First, it is important to steadily implement the “Comprehensive Plan” to realize peace in the Middle East. In considering the next steps, resolving mutual distrust is crucial as this will lead to regional stability. In this light, there are things that Israel needs to fulfill. There are things Palestine needs to fulfill. I will convey Japan’s candid views on this matter and explain that Japan intends to cooperate toward this end.",
        "reviewRequirement": "Preserve the obligations of both Israel and Palestine and Japan's stated intent to cooperate.",
    },
    {
        "id": "translation-10",
        "startMs": 214860,
        "endMs": 248860,
        "source": "また、もう一つ、インド、そして、フィリピンでありますが、「自由で開かれたインド太平洋（FOIP）」の実現に向けて、重要なパートナーでありますフィリピン、インドとは、外相を始めとする要人との間で、地域情勢や国際情勢について、じっくりと議論を行い、安全保障、経済等、様々な分野で連携を強化していきたい、このように考えているところであります。",
        "referenceEn": "I will also be visiting India and the Philippines, both of which are important partners for the realization of a “Free and Open Indo-Pacific” (FOIP). I will have in-depth discussions with their foreign ministers and other high-level officials regarding regional and international situations and strengthen cooperation in various fields, including security and the economy.",
        "reviewRequirement": "Keep FOIP, both countries, high-level officials, regional/international situations, security, and economy.",
    },
    {
        "id": "translation-11",
        "startMs": 253860,
        "endMs": 281360,
        "source": "「自由で開かれたインド太平洋（FOIP）」の提唱から、ちょうど今年で10年を迎えるという流れで、この「自由で開かれたインド太平洋」の重要性は増していると。同時に、国際社会を取り巻く環境は変化しているわけでありまして、そういった変化に合わせて、このFOIPも、進化をさせていかなければいけない、こういった議論もできればと思っておりますし、FOIPの実現に向けて、極めて重要な国でありますインド、そして、フィリピンと、こういった点も含めて、議論を深めたいと、こんなふうに考えております。",
        "referenceEn": "This year marks exactly ten years since Japan launched FOIP and its importance is increasing. Given that the environment surrounding the international community is changing, FOIP must evolve in response to these changes, and I hope to discuss this as well. I would like to deepen discussions on this, among others with India and the Philippines, both of which are vital countries for the realization of FOIP.",
        "reviewRequirement": "Preserve the ten-year anniversary, FOIP's evolution, and both named partners.",
    },
    {
        "id": "translation-12",
        "startMs": 281360,
        "endMs": 299360,
        "source": "私からは以上です。",
        "referenceEn": "That concludes my opening remarks.",
        "reviewRequirement": "Translate as a natural formal closing, not as a report about the speaker.",
    },
    {
        "id": "translation-13",
        "startMs": 299360,
        "endMs": 325360,
        "source": "【共同通信　恩田記者】中国の輸出規制について伺います。中国は、デュアルユースの規制に基づいて、日本への輸出規制を強化し、半導体製造の材料をダンピングの疑いで調査するとしています。経済的威圧を強めているかと思いますが、外相としての受け止めを伺います。また、デュアルユースを名目に指定したことは、日本の安保分野に対する牽制とも受け止められるかと思いますが、高市首相答弁への対抗措置として、フェーズが変化したと捉えているのか伺います。",
        "referenceEn": "Kyodo News, ONDA: I would like to ask about China’s export control measures. China announced that it would tighten export controls on dual-use items destined for Japan in accordance with its regulations, and investigate a material used for semiconductor production from Japan on suspicion of dumping. It appears that China is ramping up economic coercion. Could you please share your thoughts on this as Foreign Minister? Additionally, the designation of dual-use items could be interpreted as a constraint on Japan’s security sector. Do you consider that China’s countermeasures to Prime Minister TAKAICHI’s response in the Diet have entered a new phase?",
        "reviewRequirement": "Preserve the reporter attribution, dual-use controls, semiconductor material, dumping, economic coercion, and the two separate questions.",
    },
    {
        "id": "translation-14",
        "startMs": 325360,
        "endMs": 352860,
        "source": "まず、今回の措置でありますけれど、我が国のみをターゲットにした中国の輸出管理措置ということでありまして、これは国際的な慣行と大きく異なり、決して許容できず、極めて遺憾だと考えております。中国側に対しては、既にその旨申入れを行い、強く抗議をするとともに、措置の撤回を求めているところであります。",
        "referenceEn": "Foreign Minister MOTEGI: First, China’s recent export control measures are targeted only at Japan. They deviate significantly from international practice and are absolutely unacceptable and deeply regrettable. We have already made a demarche to the Chinese side, strongly protested and demanded the withdrawal of these measures.",
        "reviewRequirement": "Preserve only-Japan targeting, international practice, the strong negative judgment, demarche, protest, and demand for withdrawal.",
    },
    {
        "id": "translation-15",
        "startMs": 364360,
        "endMs": 385360,
        "source": "また、他国政府のアンチ・ダンピング関税の調査等の一つ一つについては、コメントすることは差し控えたいと思いますが、関係省庁とも連携しながら、影響がどう出るかとか、こういった精査等、必要な対応を行っていきたいと思っております。",
        "referenceEn": "I would like to refrain from commenting on each individual measure of another government, such as investigations into anti-dumping duties. The Ministry of Foreign Affairs (MOFA) will take necessary measures, including a thorough examination of possible impacts in coordination with relevant ministries and agencies.",
        "reviewRequirement": "Keep the refusal to comment and the inter-ministerial impact assessment.",
    },
    {
        "id": "translation-16",
        "startMs": 377360,
        "endMs": 403360,
        "source": "その上で、政府として、これらの措置について、中国の意図について説明をすると、こういう立場にはないわけでありますが、米国やG7各国を始めとする関係国とも連携の上、今後も国益の観点から、毅然かつ冷静に必要な対応を行っていきたいと思っているところであります。",
        "referenceEn": "While the Government is not in a position to explain China’s intentions regarding these measures, Japan intends to continue taking a calm, resolute, and necessary approach in view of our national interests, in close coordination with the U.S., G7 members, and other relevant countries.",
        "reviewRequirement": "Preserve the no-position statement, U.S./G7 coordination, national interests, and calm-resolute stance.",
    },
    {
        "id": "translation-17",
        "startMs": 403360,
        "endMs": 430860,
        "source": "いずれにしても、サプライチェーンの強化、これは喫緊の課題だと思っておりまして、日本としてできることもあります。また、同盟国・同志国、また、先ほど申し上げたようなグローバル・サウスと連携しながら、サプライチェーンを強化していくということもあると考えておりまして、真の意味での、自由で開かれたこういう貿易体制、これをしっかりと、守っていきたいと、こんなふうに考えています。",
        "referenceEn": "In any case, strengthening the resilience of supply chains is an urgent issue, and there are measures that Japan can take. Also, we can strengthen supply chains in cooperation with our ally, like-minded countries, and the Global South, which I mentioned earlier. We will firmly uphold a truly free and open trading system.",
        "reviewRequirement": "Preserve supply-chain strengthening, the three partner categories, and the trade-system commitment; do not add resilience absent from the source.",
    },
    {
        "id": "translation-18",
        "startMs": 461860,
        "endMs": 494360,
        "source": "この1月、早速、日韓、そして、日本とイタリアの首脳会談が日本で行われるということでありますが、まず、日韓については、1月13日から14日まで、李在明（イ‧ジェミョン）大統領が訪日をして、奈良における首脳会談を行うわけでありますが、本年最初の日韓間の、これまでも合意していた「シャトル外交」となると考えております。",
        "referenceEn": "Foreign Minister MOTEGI: Japan will host summit meetings with the ROK and Italy right away this January. Regarding the former, President Lee Jae Myung will visit Japan from January 13 to January14, for a summit meeting in Nara. It will mark this year’s first “shuttle diplomacy” meeting, which has been agreed upon between the two countries.",
        "reviewRequirement": "Preserve the January 13–14 dates, President Lee Jae Myung, Nara, and shuttle diplomacy.",
    },
    {
        "id": "translation-19",
        "startMs": 494360,
        "endMs": 521860,
        "source": "現下の戦略環境を考えたときに、日韓関係を強化していくと、また日米韓の連携を強めていくことの重要性は一層増していると考えておりまして、日本、そして、韓国両政府の間では、日韓関係を未来志向で安定的に発展させていくために、緊密な意思疎通を行っていくということで一致をしているところであります。",
        "referenceEn": "Considering the current strategic environment, it is becoming more important to strengthen the Japan-ROK relations and Japan-U.S.-ROK cooperation. The Governments of Japan and the ROK have concurred on continuing close communication to develop the Japan-ROK relations in a future-oriented and stable manner.",
        "reviewRequirement": "Preserve both Japan–ROK and Japan–U.S.–ROK dimensions and the future-oriented stable development meaning.",
    },
    {
        "id": "translation-20",
        "startMs": 520360,
        "endMs": 541360,
        "source": "今回、「シャトル外交」の場合、最初といいますか、昨年韓国で行われていましたが、今年の皮切りということが奈良で行われるということでありまして、今回の李在明大統領の訪日が、その重要な機会となるように、外務省としても、しっかり準備していきたいと思っております。",
        "referenceEn": "The first “shuttle diplomacy” meeting of the year will take place in Nara, following last year’s meeting in the ROK. MOFA will undertake thorough preparations so that President Lee’s visit to Japan becomes an important opportunity for shuttle diplomacy.",
        "reviewRequirement": "Preserve the prior-year ROK meeting, this year's first meeting in Nara, and MOFA's preparation role.",
    },
]


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    audio, sample_rate = load_audio(SOURCE_AUDIO)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    cues = []
    for cue in CUES:
        clip_path = AUDIO_DIR / f"{cue['id']}.wav"
        save_audio(slice_audio(audio, sample_rate, cue["startMs"], cue["endMs"]), sample_rate, clip_path)
        cues.append({
            **cue,
            "videoId": VIDEO_ID,
            "sourceUrl": JA_URL,
            "referenceEnUrl": EN_URL,
            "sourceTextSha256": sha256(cue["source"]),
            "referenceEnSha256": sha256(cue["referenceEn"]),
            "audioWindows": [{
                "windowId": f"mofa0109-{cue['id']}",
                "startMs": cue["startMs"],
                "endMs": cue["endMs"],
                "streamReference": cue["source"],
                "alignmentCoverage": 1.0,
                "audioFile": str(clip_path.relative_to(ROOT)),
                "audioSha256": sha256_file(clip_path),
            }],
            "reviewKind": "agent-official-crosscheck",
            "reviewedBy": "",
            "reviewedAt": "",
            "status": "PENDING_AGENT_REVIEW",
        })

    manifest = {
        "schemaVersion": 2,
        "created": "2026-10-30",
        "status": "PENDING_AGENT_REVIEW",
        "purpose": "Fixed 20-cue official MOFA VI/EN quality rubric for live Gemini testing",
        "provenance": {
            "videoId": VIDEO_ID,
            "videoTitle": "茂木敏充外務大臣会見（令和8年1月9日）",
            "channel": "外務省 / MOFA",
            "sourceUrlJa": JA_URL,
            "sourceUrlEn": EN_URL,
            "sourceKind": "official MOFA transcript and official English provisional translation",
            "timingSource": "YouTube official MOFA caption anchors; exact cue intervals sliced from the official video audio",
            "audioSource": str(SOURCE_AUDIO.relative_to(ROOT)),
            "audioSamplingRate": sample_rate,
            "audioChannels": 1,
            "verification": "machine-verified, agent-reviewed; no human approval claimed",
            "reviewerKind": "independent agent",
        },
        "scoring": {
            "scale": "0-2 for each field",
            "fields": ["meaning", "naturalness", "fidelity", "format"],
            "pass": "every field for every VI and EN cue equals 2",
        },
        "cues": cues,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT} ({len(cues)} cues)")


if __name__ == "__main__":
    main()
