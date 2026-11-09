import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Gst from 'gi://Gst';
// this._appsrc is GstApp.AppSrc
import GstApp from 'gi://GstApp';

import * as Params from 'resource:///org/gnome/shell/misc/params.js';
import * as Voices from './config/voices.js';

// Azure Speech API
const trustedClientToken = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const chromiumFullVersion = '143.0.3650.75';
const windowsFileTimeEpoch = 11644473600n;
const wsBaseUrl = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const edgeOrigin = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const defaultVoice = 'zh-CN-XiaoxiaoNeural';
const defaultCodec = 'audio-24khz-48kbitrate-mono-mp3';
const audioPathHeader = new TextEncoder().encode('Path:audio\r\n');

let writeToFile = false;

// https://github.com/SchneeHertz/node-edge-tts/blob/master/src/drm.ts
function generateSecMsGecToken() {
    const ticks = BigInt(Math.floor((Date.now() / 1000) + Number(windowsFileTimeEpoch))) * 10000000n
    const roundedTicks = ticks - (ticks % 3000000000n)

    const strToHash = `${roundedTicks}${trustedClientToken}`

    /*
    const hash = createHash('sha256')
    hash.update(strToHash, 'ascii')
    return hash.digest('hex').toUpperCase()
    */
    //let checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
    let token = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, strToHash, -1);
    return token.toUpperCase();
}

function escapeXml(unsafe) {
    return `${unsafe}`.replace(/[<>&"']/g, c => {
        switch (c) {
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '&':
                return '&amp;';
            case '"':
                return '&quot;';
            case "'":
                return '&apos;';
            default:
                return c;
        }
    });
}

function findVoiceConfig(voice) {
    if (!voice)
        return null;

    let lowerVoice = voice.toLowerCase();
    return Voices.voices.find(v =>
        v.Name.toLowerCase() === lowerVoice ||
        v.ShortName.toLowerCase() === lowerVoice);
}

function normalizeVoiceName(voice) {
    if (!voice)
        return defaultVoice;

    let voiceConfig = findVoiceConfig(voice);
    if (voiceConfig)
        return voiceConfig.ShortName;

    let match = voice.match(/\(([^,]+),\s*([^)]+)\)/);
    if (match)
        return `${match[1]}-${match[2].replace(/\s+/g, '')}`;

    return voice;
}

function getLocaleFromVoiceName(voice) {
    if (!voice)
        return 'en-US';

    let voiceConfig = findVoiceConfig(voice);
    if (voiceConfig)
        return voiceConfig.Locale;

    let match = voice.match(/\(([^,]+),\s*([^)]+)\)/);
    if (match)
        return match[1];

    match = normalizeVoiceName(voice).match(/^([a-z]{2,3}-[A-Z]{2})-/);
    if (match)
        return match[1];

    return 'en-US';
}

function findBytes(data, needle) {
    if (needle.length === 0 || data.length < needle.length)
        return -1;

    for (let i = 0; i <= data.length - needle.length; i++) {
        let matched = true;
        for (let j = 0; j < needle.length; j++) {
            if (data[i + j] !== needle[j]) {
                matched = false;
                break;
            }
        }
        if (matched)
            return i;
    }

    return -1;
}

export class AzureTTS extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    _init(params) {
        params = Params.parse(params, null);
        this.engine = params.engine || defaultVoice;
        this.codec = params.codec || defaultCodec;
        this.lang = params.lang || null;
        this.rate = params.rate || 'default';
        this.pitch = params.pitch || 'default';
        this.volume = params.volume || 'default';
        this._decoder = new TextDecoder('utf-8');
    }

    _play(text) {
        if (!this._session)
            this._session = new Soup.Session();
        else
            this._session.abort();

        /*
        session.user_agent = 'Mozilla/5.0 (X11; Linux x86_64; rv:95.0) Gecko/20100101 Firefox/95.0';
        session.timeout = 15000;
        */
        let wsUrl = `${wsBaseUrl}?TrustedClientToken=${trustedClientToken}&Sec-MS-GEC=${generateSecMsGecToken()}&Sec-MS-GEC-Version=1-${chromiumFullVersion}`;
        let message = Soup.Message.new("GET", wsUrl);
        if (message == null) {
            log("Failed to create Soup message");
            return;
        }
        message.request_headers.append('Pragma', 'no-cache');
        message.request_headers.append('Cache-Control', 'no-cache');
        message.request_headers.append('User-Agent', this._userAgent());
        message.request_headers.append('Accept-Encoding', 'gzip, deflate, br, zstd');
        message.request_headers.append('Accept-Language', 'en-US,en;q=0.9');

        this._closed = false;
        this._cancellable = new Gio.Cancellable();
        this._session.websocket_connect_async(message, edgeOrigin, null, 0, this._cancellable,
            (session, result) => {
                try {
                    this.websocket = session.websocket_connect_finish(result);
                } catch (e) {
                    log('Failed to connect: ' + e.message);
                    return;
                }
                this.websocket.connectObject(
                    'message', (ws, type, msg) => {
                        this._onMessage(type, msg);
                    },
                    'closed', () => {
                        this._onClosed();
                    },
                    'error', (ws, error) => {
                        this._onError(error);
                    },
                    this);
                this._sendText(text);
            }
        );
    }

    _userAgent() {
        let edgeMajorVersion = chromiumFullVersion.split('.')[0];
        return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
            `(KHTML, like Gecko) Chrome/${edgeMajorVersion}.0.0.0 Safari/537.36 ` +
            `Edg/${edgeMajorVersion}.0.0.0`;
    }

    _sendText(text) {
        let speechConfig = {
            context: {
                synthesis: {
                    audio: {
                        metadataoptions: {
                            sentenceBoundaryEnabled: 'false',
                            wordBoundaryEnabled: 'true',
                        },
                        outputFormat: this.codec,
                    },
                },
            },
        };
        let msg = 'Content-Type:application/json; charset=utf-8\r\n'
            + 'Path:speech.config\r\n\r\n'
            + JSON.stringify(speechConfig);
        this.websocket.send_text(msg);

        let connectId = GLib.uuid_string_random().replaceAll('-', '');
        let voice = normalizeVoiceName(this.engine);
        let lang = this.lang || getLocaleFromVoiceName(this.engine);
        msg = 'X-RequestId:' + connectId + '\r\n'
            + 'Content-Type:application/ssml+xml\r\n'
            + 'Path:ssml\r\n\r\n'
            + `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" `
            + `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">`
            + `<voice name="${voice}">`
            + `<prosody rate="${this.rate}" pitch="${this.pitch}" volume="${this.volume}">`
            + escapeXml(text)
            + '</prosody></voice></speak>';
        this.websocket.send_text(msg);
    }

    _onMessage(type, msg) {
        if (type == Soup.WebsocketDataType.TEXT) {
            const data = this._decoder.decode(msg.toArray());
            if (data.indexOf('turn.end') != -1) {
                this._closed = true;
                this._appsrc.end_of_stream();
                this.websocket.close(Soup.WebsocketCloseCode.NORMAL, '');
            }
        } else if (type == Soup.WebsocketDataType.BINARY) {
            let bytes = msg.toArray();
            let offset = findBytes(bytes, audioPathHeader);
            if (offset < 0)
                return;

            offset += audioPathHeader.length;
            let data = GLib.Bytes.new_from_bytes(msg, offset, msg.get_size() - offset);
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
        let flowRet = this._appsrc.push_buffer(buf);
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
        this._closeFile();
        this._playerState = Gst.State.PLAYING;
        this._pipeline.set_state(Gst.State.PLAYING);
        this._disconnectSignals();
        this.websocket = null;
    }

    _onError(reason) {
        if (!this._closed)
            log('Error: ' + reason);
        this._playerState = Gst.State.NULL;
    }

    _disconnectSignals() {
        if (this.websocket)
            this.websocket.disconnectObject(this);
    }

    _stopPlayAudio() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this.websocket) {
            this._disconnectSignals();
            this.websocket.close(Soup.WebsocketCloseCode.NORMAL, '');
            this.websocket = null;
        }
        this._closeFile();
        this._playerState = Gst.State.NULL;
        this._pipeline.set_state(Gst.State.VOID_PENDING);
        this._pipeline.set_state(Gst.State.PAUSED);
        if (this._watchId) {
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
            this._pipeline = Gst.parse_launch('appsrc name=src ! mpegaudioparse ! mpg123audiodec ! audioconvert ! audioresample ! autoaudiosink');// pipewiresink');
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
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }
}
