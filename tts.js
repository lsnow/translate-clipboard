import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Gst from 'gi://Gst';
// this._appsrc is GstApp.AppSrc
import GstApp from 'gi://GstApp';

import * as Params from 'resource:///org/gnome/shell/misc/params.js';

// Azure Speech API
const trustedClientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const wsUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken='+trustedClientToken;
const engineListUrl = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voice/list?TrustedClientToken='+trustedClientToken;

let debug_tts = false;
let writeToFile = false;

export class AzureTTS extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    _init(params) {
        if (debug_tts == false) {
            params = Params.parse(params, {
                engine: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoXiaoNeural)',
                codec: 'audio-24khz-48kbitrate-mono-mp3',
            });
        }

        this.engine = params.engine;
        this.codec = params.codec;
        this._decoder = new TextDecoder('utf-8');
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
        session.websocket_connect_async(message, null, null, 0, this._cancellable,
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
        let date = new Date().toString();
        let msg = 'X-Timestamp:' + date
            + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
            + '{"context":{"synthesis":{"audio":{"metadataoptions":'
            + '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"'
            + this.codec
            + '"}}}}\r\n';
        this.websocket.send_text(msg);

        let connectId = GLib.uuid_string_random().replaceAll('-', '');
        msg = "X-RequestId:" + connectId + "\r\n"
            + "Content-Type:application/ssml+xml\r\n"
            + "X-Timestamp:" + date + "Z\r\n"
            + "Path:ssml\r\n\r\n"
            + "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice  name='"
            + this.engine
            + "'><prosody pitch='+0Hz' rate ='+0%' volume='+0%'>"
            + text
            + "</prosody></voice></speak>\r\n";
        this.websocket.send_text(msg);
    }

    _onMessage(type, msg) {
        if (type == Soup.WebsocketDataType.TEXT) {
            const data = this._decoder.decode(msg.toArray());
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
            if (!this._watchId) {
                let bus = this._pipeline.get_bus();
                this._watchId = bus.add_watch(bus, this._onBusMessage.bind(this));
                //this._pipeline.set_state(Gst.State.PLAYING);
            }
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
        if (this._watchId)
        {
            GLib.source_remove(this._watchId);
            this._watchId = 0;
        }
    }

    playAudio(text) {
        this._text = text;
        if (text == null)
            this._text = 'TTS test';

        if (!this._pipeline) {
            if (!Gst.is_initialized())
                Gst.init(null);
            this._pipeline = Gst.parse_launch('appsrc name=src ! mpegaudioparse ! mpg123audiodec ! audioconvert ! pipewiresink');
            this._appsrc = this._pipeline.get_by_name('src');
            this._playerState = Gst.State.NULL;
        }

        this._stopPlayAudio();
        this._play(this._text);
    }

    cleanup() {
        if (this._pipeline) {
            this._stopPlayAudio();
            this._pipeline.set_state(Gst.State.NULL);
            this._pipeline = null;
        }
    }
}
/*
let params = {
    engine: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoXiaoNeural)',
    //engine: 'zh-CN-XiaoXiaoNeural',
    codec: 'audio-24khz-48kbitrate-mono-mp3',
};

let loop = GLib.MainLoop.new(null, false);
var test = new AzureTTS (params);
test.playAudio('乘彼白云，至于帝乡。');
//test.playAudio(null);
loop.run();
*/
