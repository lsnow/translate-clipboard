import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import * as Languages from './languages.js';
const ByteArray = imports.byteArray;

export const providers = {
    /*
    "huggingface": {
        name: "Hugging Face",
        providers: [
            "novita",
        ],
        models: [
            "deepseek-ai/DeepSeek-V3-0324",
        ],
        endpoint: "https://api-inference.huggingface.co",
        getUrl: function(endpoint, model) {
            return `${endpoint}/models/${model}/v1/chat/completions`;
        },
        signup: "https://huggingface.co",
        getApiKey: function() {
            return GLib.getenv("HUGGINGFACE_API_KEY");
        }
    },
    */
    "openrouter": {
        name: "OpenRouter",
        models: [
            "deepseek/deepseek-chat-v3-0324:free",
            "google/gemini-2.5-flash-preview",
            "deepseek/deepseek-r1",
            "anthropic/claude-3.7-sonnet:beta", // $3/15
            "anthropic/claude-3.7-sonnet", // $3/15
            "anthropic/claude-3.5-sonnet", // $3/15
            "openai/o3-mini-high",
            "openai/chatgpt-4o-latest", // $5/15
            "qwen/qwq-32b:free",
        ],
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        getUrl: function(endpoint) {
            return endpoint;
        },
        signup: "https://openrouter.ai/",
        modelsUri: "https://openrouter.ai/models",
        getApiKey: function() {
            return GLib.getenv("OPENROUTER_API_KEY");
        }
    },
    "gemini":{
        name: "Google Gemini",
        models: [
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
            "gemini-1.0-pro"
        ],
        endpoint: "",
        getUrl: function(endpoint, model, api_key) {
            return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${api_key}`;
        },
        signup: "https://ai.google.dev/tutorials/web_quickstart#set-up-api-key",
        getApiKey: function() {
            return GLib.getenv("GEMINI_API_KEY");
        },
        parseOutput(output) {
            if (output.candidates && output.candidates[0].content)
                return output.candidates[0].content.parts[0].text;
            return output;
        }
    },
    "openai":{
        name: "OpenAI",
        models: [
            "o1-mini",
            "o1-preview",
            "o1",
            "o3-mini",
            "gpt-3.5-turbo",
            "gpt-4",
            "gpt-4o-mini",
            "gpt-4o",
            "chatgpt-4o-latest",
        ],
        endpoint: "https://api.openai.com/v1/chat/completions",
        signup: "https://platform.openai.com/api-keys",
        getApiKey: function() {
            return GLib.getenv("OPENAI_API_KEY");
        }
    },
    "deepseek":{
        name: "DeekSeek",
        models: ['deepseek-chat', 'deepseek-reasoner'],
        endpoint: "https://api.deepseek.com/chat/completions",
        signup: "https://platform.deepseek.com/api_keys",
        getApiKey: function() {
            return GLib.getenv("DEEPSEEK_API_KEY");
        }
    },
    /*
    "xai":{
        name: "xAI",
        models: ["grok-beta"],
        endpoint: "https://api.x.ai/v1/chat/completions",
        signup: "https://x.ai",
        getApiKey: function() {
            return GLib.getenv("XAI_API_KEY");
        }
    },
    "ollama":{
        name: "ollama",
        models: [],
        endpoint: "http://localhost:11434/api/chat",
        signup: "",
        getApiKey: function() {
            return GLib.getenv("OLLAMA_API_KEY");
        }
    }
    */
};

export var AiTranslator = GObject.registerClass({
    Signals: {
        'completed': {
            param_types: [GObject.TYPE_STRING],
            accumulator: GObject.signal_accumulator_true_handled
        },
        'thinking': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING]
        },
        'error': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_STRING]
        }
    },
}, class AiTranslator extends GObject.Object {
    _init(params) {
        super._init();
        if (params) {
            this._provider = providers[params.provider];
            this._model = params.model;
            this._temperature = params.temperature;
            this._top_p = params.topP;
            this._top_k = params.topK;
            this._min_p = params.minP;
            this._api_key = params.apiKey;
            this._prompt = params.prompt;
        }
        if (!this._provider)
            this._provider = providers['openrouter'];
        if (!this._model)
            this._model = this._provider.models[0];
        if (!this._api_key)
            this._api_key = this._provider.getApiKey();
        if (!this._prompt)
            this.setPrompt(null);
    }
    setProvider(provider) {
        this._provider = providers[provider];
        if (!this._provider)
            this._provider = providers['openrouter'];
    }

    setModel(model) {
        this._model = model;
    }

    getModels(provider) {
        return providers[provider].models;
    }

    setPrompt(prompt) {
        if (prompt)
            this._prompt = prompt;
        else
            this._prompt = 'Translate from {origin_language} to {destination_language}, the text:\n{selected_text}\nResponse only with the text translated and nothing more.';
    }

    getPrompt() {
        return this._prompt;
    }

    _buildMessageBody(from, to, text) {
        let destLang = Languages.isoLangs[to].name;
        let prompt = this._prompt.replaceAll('{destination_language}', destLang)
            .replace('{selected_text}', text);
        if (from != 'auto') {
            let origLang = Languages.isoLangs[from].name;
            prompt = prompt.replaceAll('{origin_language}', origLang);
        }
        let body = JSON.stringify({
            "model": this._model,
            "messages": [
                {"role": "system", "content": "You are a helpfull assistant."},
                {"role": "user", "content": prompt}
            ],
            "stream": false
        });
        //log(body);
        return body;
    }

    translate(from, to, proxy, text) {
        let session = new Soup.Session();
        session.set_timeout(10);
        if ((proxy != null) && (proxy != '')) {
            let proxyResolver = Gio.SimpleProxyResolver.new(proxy, null);
            if (proxyResolver)
                session.set_proxy_resolver(proxyResolver);
            else
                this.emit('error', 'Invalid proxy protocol');
        }

        let url = this._provider.getUrl ? this._provider.getUrl(this._provider.endpoint, this._model) : this._provider.endpoint;
        let request = Soup.Message.new('POST', url);
        request.request_headers.append('Authorization', `Bearer ${this._api_key}`);
        request.request_headers.append('Content-type', 'application/json');
        let bytes = GLib.Bytes.new(ByteArray.fromString(this._buildMessageBody(from, to, text)));
        request.set_request_body_from_bytes('application/json', bytes);

        try {
            session.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null,
                (session, result, error) => {
                    if (error) {
                        this.emit('error', 'Failed to connect: ' + error.message);
                    }
                    else {
                        this._processMessage(session, result, request.status_code);
                    }
                }
            );
        } catch (error) {
            this.emit('error', 'Unable to send libsoup json message: ' + error.message);
        }
    }

    _parseError(data) {
        let error = JSON.parse(data);
        if (error && this._provider.parseError)
            return this._provider.parseError(error);
        if (error && error.error)
            return error.error.message;
        return data;
    }

    _parseMessage(data) {
        let message = JSON.parse(data);
        if (message && this._provider.parseOutput)
            return this._provider.parseOutput(message);
        if (message && message.choices && message.choices[0].message)
            return message.choices[0].message.content;
        return message;
    }

    _processMessage(session, message, status) {
        try {
            const decoder = new TextDecoder();
            let data = decoder.decode(session.send_and_read_finish(message).get_data());
            //log('status: ' + status + ', data: ' + data);
            if (status != 200)
                this.emit('error', this._parseError(data));
            else
                this.emit('completed', this._parseMessage(data));
        } catch (error) {
            this.emit('error', error.message);
        }
    }
});

/*
let params = {
    provider: 'openrouter',
    model: 'deepseek/deepseek-chat-v3-0324:free'
};

var loop = GLib.MainLoop.new(null, false);
const test = new AiTranslator(params);
test.translate('en_US', 'zh_CN', null, 'hello, deepseek');
loop.run();
*/
