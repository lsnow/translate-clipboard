export const Fields = {
    ENABLE_TRANS: 'enable-trans',
    ENABLE_SELECTION: 'enable-selection',
    BRIEF_MODE: 'brief-mode',
    AUTO_CLOSE: 'auto-close',
    AUTO_HIDE_MODE: 'auto-hide-mode',
    FROM: 'from',
    TO: 'to',
    TRANS_SELECTED: 'translate-selected-text',
    TTS_ENGINE: 'voice',
    PROXY: 'proxy',
    ENGINE: 'engine',
    LLM_PROVIDER: 'llm-provider',
    PROVIDER_SETTINGS: 'provider-settings'
};

export const defaultConfig = {
    'endpoint': '',
    'model': '',
    'temperature': 0.9,
    'topP': 0.7,
    'topK': 20,
    'minP': 0.0,
    'prompt': 'Please respect the original meaning, maintain the original format, and rewrite the given content in {destination_language}, if it is a domain-specific term, please explain it briefly:\n{selected_text}'
};

