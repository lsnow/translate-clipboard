import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

//import * as Params from 'resource:///org/gnome/shell/misc/params.js';

const GOOGLE_TRANSLATION_URL = "https://translate.googleapis.com/translate_a/single";
const DEEPLFREE_TRANSLATION_URL = "https://www2.deepl.com/jsonrpc";

function GenGoogleParams(from, to, text) {
    const params =
        'client=gtx&' +
        'dt=bd&dt=ex&dt=ld&dt=md&dt=rw&dt=rm&dt=ss&dt=t&dt=at&dt=gt&dt=qca' +
        'dj=1&' +
        'ie=UTF-8&' +
        'sl=' + from + '&' +
        'tl=' + to + '&' +
        'q=' + text;
    return params;
}

export var GoogleTranslator = GObject.registerClass({
    Signals: {
        'completed': { param_types: [GObject.TYPE_STRING] },
        'error': { param_types: [GObject.TYPE_STRING] }
    },
}, class GoogleTranslator extends GObject.Object {
    setEngine(engine) {
        this._engine = engine;
    }

    translate(from, to, proxy, text) {
        let session = new Soup.Session();
        if ((proxy != null) && (proxy != '')) {
            let proxyResolver = Gio.SimpleProxyResolver.new(proxy, null);
            if (proxyResolver)
                session.set_proxy_resolver(proxyResolver);
            else
                this.emit('error', 'Invalid proxy protocol');
        }

        let params = GenGoogleParams(from, to, text);
        let url = GOOGLE_TRANSLATION_URL + '?' + params;
        let request = Soup.Message.new('GET', url);
        //request.request_headers.append('Accept', 'application/json');
        request.request_headers.append('Content-type', 'application/json');

        try {
            session.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null,
                (session, result, error) => {
                    if (error) {
                        //log('Failed to connect: ' + error.message);
                        this.emit('error', 'Failed to connect: ' + error.message);
                        return;
                    }
                    else {
                        this._processMessageRefresh(session, result, request.status_code);
                    }
                }
            );
        }
        catch (error) {
            log('unable to send libsoup json message: ' + error);
        }
    }

    _processMessageRefresh(session, message, status) {
        try {
            const decoder = new TextDecoder();
            let data = (Soup.MAJOR_VERSION >= 3) ?
                decoder.decode(session.send_and_read_finish(message).get_data()) : // Soup3
                message.response_body.data; // Soup 2

            if (status == 404)
                this.emit('error', '404 (Page not found)');
            else
                this.emit('completed', data);
        } catch (error) {
            this.emit('error', error.message);
        }
    }

    cleanup() {
    }
});

/*
let loop = GLib.MainLoop.new(null, false);
let test = new GoogleTranslator();
log(test);
//test.connect('completed', onCompleted);
test.connect('completed', (emitter, data) => {
  log('Recieve completed: ' + data);
});

test.connect('error', (emitter, data) => {
  log('Error: ' + data);
});
test.translate('en', 'zh', '', 'coefficient');
loop.run();
*/
