import GLib from 'gi://GLib';

export var Fields = {
    ENABLE_TRANS: 'enable-trans',
    ENABLE_SELECTION: 'enable-selection',
    BRIEF_MODE: 'brief-mode',
    AUTO_CLOSE: 'auto-close',
    FROM: 'from',
    TO: 'to',
    TRANS_SELECTED: 'translate-selected-text',
    TTS_ENGINE: 'voice',
    PROXY: 'proxy',
    ENGINE: 'engine',
    LLM_PROVIDER: 'llm-provider',
    PROVIDER_SETTINGS: 'provider-settings'
};

export var defaultConfig = {
    'model': '',
    'apiKey': '',
    'temperature': 0.9,
    'topP': 0.7,
    'topK': 20,
    'minP': 0.0,
    'prompt': 'Please respect the original meaning, maintain the original format, and rewrite the given content in {destination_language}.\nFor cultural or context-specific references that may not directly translate, paraphrase to preserve the intended meaning or provide a brief explanation.\nThe emphasis should be on maintaining the integrity of the technical content while ensuring the translation is comprehensible and contextually accurate in {destination_language}.\nThis is the text to translate:\n{selected_text}'
};

export function readConfig(settings, key) {
    const variant = settings.get_value(key);
    const data = variant.recursiveUnpack();
    //log(`Unpacked JavaScript data: ${JSON.stringify(data, null, 2)}`);
    return data;
}

export function writeConfig(settings, key, configs) {
    let packed = {};
    for (const [provider, config] of Object.entries(configs)) {
        const model = new GLib.Variant('s', config.model);
        const apiKey = new GLib.Variant('s', config.apiKey);
        const temperature = GLib.Variant.new_double(config.temperature);
        const topP = GLib.Variant.new_double(config.topP);
        const topK = GLib.Variant.new_uint32(config.topK);
        const minP = GLib.Variant.new_double(config.minP);
        const prompt = new GLib.Variant('s', config.prompt);
        const variantObject = {
            model: model,
            apiKey: apiKey,
            temperature: temperature,
            topP: topP,
            topK: topK,
            minP: minP,
            prompt: prompt
        };
        packed[provider] = new GLib.Variant('a{sv}', variantObject);
    }
    const variant = new GLib.Variant('a{sv}', packed);
    settings.set_value(key, variant);
}
