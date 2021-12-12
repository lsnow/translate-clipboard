// For test
// imports.gi.versions.Soup = '3.0';

// For Gnome Shell
imports.gi.versions.Soup = '2.4';
const { GLib, Gio, GObject, Soup, Gst, GstApp } = imports.gi;
const ByteArray = imports.byteArray;
const Params = imports.misc.params;
const Me = imports.misc.extensionUtils.getCurrentExtension();

// Azure Speech API
const trustedClientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const wsUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken='+trustedClientToken;
const engineListUrl = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voice/list?TrustedClientToken='+trustedClientToken;

let writeToFile = false;

var AzureTTS = GObject.registerClass(
class AzureTTS extends GObject.Object {
    _init(params) {
        params = Params.parse(params, {
            engine: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoXiaoNeural)',
            codec: 'audio-24khz-48kbitrate-mono-mp3',
        });

        this._engine = params.engine;
        this._codec = params.codec;

        Gst.init(null);
        this._pipeline = Gst.parse_launch('appsrc name=src ! mpegaudioparse ! mpg123audiodec ! audioconvert ! autoaudiosink');
        this._appsrc = this._pipeline.get_by_name('src');
        this._playerState = Gst.State.NULL;
    }

    _play(text) {
        let session = new Soup.Session();
        /*
        session.user_agent = 'Mozilla/5.0 (X11; Linux x86_64; rv:95.0) Gecko/20100101 Firefox/95.0';
        session.timeout = 15000;
        */
        let message = Soup.Message.new ("GET", wsUrl);
        if (message == null) {
            log("Failed to create Soup message");
            return;
        }
        this._cancellable = new Gio.Cancellable();
        session.websocket_connect_async(message, null, null, this._cancellable,
                                             (session, result, error) => {
                                                 if (error) {
                                                     log('Failed to connect: ' + error.message);
                                                     return;
                                                 }
                                                 this.websocket = session.websocket_connect_finish(result);
                                                 this._onMessageId = this.websocket.connect('message', (ws, type, msg) => {
                                                     this._onMessage(type, msg);
                                                 });
                                                 this._onClosedId = this.websocket.connect('closed', () => {
                                                     this._onClosed();
                                                 });
                                                 this._onErrorId = this.websocket.connect('error', (ws, error) => {
                                                     this._onError(error);
                                                 });
                                                 this._sendText(text);
                                             }
        );
    }

    _sendText(text) {
        let msg = 'Content-Type:application/json; charset=utf-8\r\n\r\nPath:speech.config\r\n\r\n'
            + '{"context":{"synthesis":{"audio":{"metadataoptions":'
            + '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"'
            + this._codec
            + '"}}}}\r\n';
        this.websocket.send_text(msg);

        msg = "X-RequestId:fe83fbefb15c7739fe674d9f3e81d38f\r\n"
            + "Content-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n"
            + "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice  name='"
            + this._engine
            + "'><prosody pitch='+0Hz' rate ='+0%' volume='+0%'>"
            + text
            + "</prosody></voice></speak>\r\n";
        this.websocket.send_text(msg);
    }

    _onMessage(type, msg) {
        if (type == Soup.WebsocketDataType.TEXT) {
            let bytes = msg.unref_to_array();
            let data = ByteArray.toString(bytes);
            if (data.indexOf('turn.end') != -1) {
                this._closed = true;
                this.websocket.close(Soup.WebsocketCloseCode.normal, '');
                this._appsrc.end_of_stream();
            }
        } else if (type == Soup.WebsocketDataType.BINARY) {
            let [_, len] = msg.get_data();
            //log(len + 'size: ' + msg.get_size());
            len += 2;
            let data = msg.new_from_bytes(len, msg.get_size() - len);
            if (data) {
                let buf = Gst.Buffer.new_wrapped_bytes(data);
                this._pushBuffer(buf);

                if (writeToFile) {
                    if (!this.f) {
                        this.f = Gio.file_new_for_path('/tmp/test-tts.mp3');
                        let raw = this.f.replace(null, false,
                                                 Gio.FileCreateFlags.NONE,
                                                 null);
                        this.out = Gio.BufferedOutputStream.new_sized(raw, 4096 * 10);
                    }
                    this.out.write_bytes(data, null);
                }
            }
        }
    }

    _pushBuffer(buf) {
        this._appsrc.push_buffer(buf);
        if (this._playerState != Gst.State.PLAYING) {
            const bus = this._pipeline.get_bus();
            bus.add_watch(bus, this._onBusMessage.bind(this));
            //this._pipeline.set_state(Gst.State.PLAYING);
            this._playerState = Gst.State.PLAYING;
        }
    }

    _onBusMessage(bus, message) {
        switch (message.type) {
            case Gst.MessageType.EOS:
                this._stopPlayAudio();
                break;
            case Gst.MessageType.ERROR:
                this._stopPlayAudio();
                break;
            default:
                break;
        }
        return true;
    }

    _closeFile() {
        if (!writeToFile)
            return;

        if (this.out) {
            this.out.close(null);
            this.out = null;
        }
        if (this.f) {
            this.f.run_dispose();
            this.f = null;
        }
    }

    _onClosed() {
        this._playerState = Gst.State.PLAYING;
        this._pipeline.set_state(Gst.State.PLAYING);
        this._disconnectSignals();
        this.websocket = null;
        this._closeFile();
    }

    _onError(reason) {
        if (!this._closed)
            log('onError: ' + reason);
        this._playerState = Gst.State.NULL;
    }

    _disconnectSignals() {
        if (this._onMessageId) {
            this.websocket.disconnect(this._onMessageId);
            this._onMessageId = null;
        }
        if (this._onClosedId) {
            this.websocket.disconnect(this._onClosedId);
            this._onClosedId = null;
        }
        if (this._onErrorId) {
            this.websocket.disconnect(this._onErrorId);
            this._onErrorId = null;
        }
    }

    _stopPlayAudio() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this.websocket) {
            this._disconnectSignals();
            this.websocket.close(Soup.WebsocketCloseCode.normal, '');
            this.websocket = null;
        }
        this._closeFile();
        this._playerState = Gst.State.NULL;
        this._pipeline.set_state(Gst.State.VOID_PENDING);
        this._pipeline.set_state(Gst.State.PAUSED);
    }

    playAudio(text) {
        this._text = text;
        if (text == null)
            this._text = '妙手写徽真，水剪双眸点绛唇。疑是昔年窥宋玉，东邻，只露墙头一半身';

        this._stopPlayAudio();
        this._play(this._text);
    }

    cleanup() {
        this._stopPlayAudio();
        this._pipeline.run_dispose();
        Gst.deinit();
    }
}
);

/*
let params = {
    engine: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoXiaoNeural)',
    codec: 'audio-24khz-48kbitrate-mono-mp3',
};

let loop = GLib.MainLoop.new(null, false);
var test = new AzureTTS (params);
//test.playAudio('乘彼白云，至于帝乡。');
test.playAudio(null);
loop.run();

loop.run();
*/
