import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

export function readConfig(settings, key) {
    const variant = settings.get_value(key);
    const data = variant.recursiveUnpack();
    //log(`Unpacked JavaScript data: ${JSON.stringify(data, null, 2)}`);
    return data;
}

export function writeConfig(settings, key, configs) {
    let packed = {};
    for (const [provider, config] of Object.entries(configs)) {
        const endpoint = new GLib.Variant('s', config.endpoint);
        const model = new GLib.Variant('s', config.model);
        const temperature = GLib.Variant.new_double(config.temperature);
        const topP = GLib.Variant.new_double(config.topP);
        const topK = GLib.Variant.new_uint32(config.topK);
        const minP = GLib.Variant.new_double(config.minP);
        const prompt = new GLib.Variant('s', config.prompt);
        const variantObject = {
            endpoint: endpoint,
            model: model,
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

export function storeApiKey(settings, provider, apikey, onError) {
    try {
        const schema = new Secret.Schema(
            settings,
            Secret.SchemaFlags.NONE,
            {
                "provider": Secret.SchemaAttributeType.STRING
            }
        );
        Secret.password_store(
            schema,
            {
                provider: provider
            },
            Secret.COLLECTION_DEFAULT,
            `apikey for ${provider}`,
            apikey,
            null, null
        );
    } catch (e) {
        onError(`Failed to store apikey for ${provider}: ${e.message}`);
    }
}

export function getApiKey(settings, provider, onComplete, onError) {
    try {
        const schema = new Secret.Schema(
            settings,
            Secret.SchemaFlags.NONE,
            {
                "provider": Secret.SchemaAttributeType.STRING
            }
        );
        Secret.password_lookup(
            schema,
            {
                provider: provider
            },
            null,
            (source, result) => {
                const apikey = Secret.password_lookup_finish(result);
                onComplete(apikey);
            }
        );
    } catch (e) {
        if (onError)
            onError(`Failed to get apikey for ${provider}: ${e.message}`);
        else
            log(`Failed to get apikey for ${provider}: ${e.message}`);
    }
}

export function removeApiKey(settings, provider, onComplete) {
    try {
        const schema = new Secret.Schema(
            settings,
            Secret.SchemaFlags.NONE,
            {
                "provider": Secret.SchemaAttributeType.STRING
            }
        );
        Secret.password_clear(
            schema,
            {
                provider: provider
            },
            null,
            (source, result) => {
                Secret.password_clear_finish(result);
                onComplete();
            }
        );
    } catch (e) {
        log(`Failed to rm apikey for ${provider}: ${e.message}`);
    }
}
