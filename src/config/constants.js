export const Fields = {
    ENABLE_TRANS: 'enable-trans',
    ENABLE_SELECTION: 'enable-selection',
    BRIEF_MODE: 'brief-mode',
    AUTO_CLOSE: 'auto-close',
    AUTO_HIDE_MODE: 'auto-hide-mode',
    FROM: 'from',
    TO: 'to',
    TO_PRIMARY: 'to-primary',
    TO_SECONDARY: 'to-secondary',
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
    'prompt': 'Translate the following text into {destination_language}. Provide brief explanations for specialized terms in the source text, and include pronunciations for complex words:\n{selected_text}'
};

