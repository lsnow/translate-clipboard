/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'translate-clipboard-extension';

const { GLib, Gio, GObject, Clutter, St, Meta } = imports.gi;

const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;
const Util = imports.misc.util;

/* crow-translation */
/*
const TRANS_CMD = "crow";
*/
const TRANS_CMD = Me.path + '/trans';

const TcIndicator = GObject.registerClass(
class TcIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Translate Clipboard'));

        this._enabled = true;
        this._oldtext = null;
        this._showOriginalPhonetics = true;

        this._cancellable = new Gio.Cancellable();

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
        });
        this._icon.gicon = Gio.icon_new_for_string(`${Me.path}/icons/translator-symbolic.svg`);
        let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        box.add_child(this._icon);
        this.add_child(box);

        let item = new PopupMenu.PopupSwitchMenuItem(_('Toggle translate'), true, null);
        item.connect('toggled', () => {
            this._enabled = item.state;
        });
        this.menu.addMenuItem(item);

        let item1 = new PopupMenu.PopupSwitchMenuItem(_('Brief mode'), false, null);
        item1.connect('toggled', () => {
            this._briefMode = item1.state;
        });
        this.menu.addMenuItem(item1);

        this._selection = global.display.get_selection();
        this._clipboard = St.Clipboard.get_default();
        this._owner_changed_id = this._selection.connect('owner-changed', () => {
            if (this._enabled)
            {
                let [x, y, mods] = global.get_pointer();
                let buttonMask = Clutter.ModifierType.BUTTON1_MASK |
                                 Clutter.ModifierType.BUTTON2_MASK |
                                 Clutter.ModifierType.BUTTON3_MASK |
                                 Clutter.ModifierType.SHIFT_MASK |
                                 Clutter.ModifierType.CONTROL_MASK |
                                 Clutter.ModifierType.SUPER_MASK;
                if (buttonMask & mods)
                    return;
                this._clipboardChanged();
            }
        });
    }

    destroy() {
        this._selection.disconnect(this._owner_changed_id);
    }

    _clipboardChanged() {
        this._clipboard.get_text(St.ClipboardType.PRIMARY,
            (clipboard, text) => {
                if (text && text != '' && text != this._oldtext &&
                    !Util.findUrls(text).length &&
                    !RegExp(/\d+/).exec(text)) {
                    this._oldtext = text;
                    this._translate(text).then(res => {
                        this._notify(res);
                    });
                }
            });
    }
    _notify(result) {
        /*
        let fields = JSON.parse(result);
        source = fields['source'];
        result = fields['translation'];
        */
        let [x, y] = global.get_pointer();
        if (!this._box)
        {
            this._box = new St.BoxLayout({ style_class: "translate-box",
                                           vertical: true,
                                           x_expand: true,
                                           y_expand: true });
            this._label = new St.Label();
            this._box.add_child(this._label);
            Main.layoutManager.addChrome(this._box);
        }
        if (this._popupTimeoutId) {
            GLib.source_remove(this._popupTimeoutId);
            this._popupTimeoutId = 0;
        }
        this._label.clutter_text.set_markup(result);
        let monitor = Main.layoutManager.currentMonitor;
        if (x + this._box.get_width() > monitor.x + monitor.width)
            x = monitor.x + monitor.width - this._box.get_width();
        if (y + this._box.get_height() > monitor.y + monitor.height)
            y = monitor.y + monitor.height - this._box.get_height();
        this._box.set_position(x, y);
        this._box.show();
        this._updatePopupTimeout(5000);
    }

    _popupTimeout() {
        let [x, y] = global.get_pointer();
        let [x_, y_] = this._box.get_transformed_position();
        let [w_, h_] = this._box.get_transformed_size();
        if (x > x_ && y > y_ &&
            x < x_ + w_ && y < y_ + h_)
        {
            this._updatePopupTimeout(1000);
            return;
        }

        this._box.hide();
        this._label.clutter_text.set_markup('');
        this._popupTimeoutId = 0;
        return GLib.SOURCE_REMOVE;
    }

    _updatePopupTimeout(timeout) {
         if (this._popupTimeoutId) {
             GLib.source_remove(this._popupTimeoutId);
             this._popupTimeoutId = 0;
         }
         if (timeout > 0) {
             this._popupTimeoutId =
                 GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout,
                     this._popupTimeout.bind(this));
             GLib.Source.set_name_by_id(this._popupTimeoutId, '[gnome-shell] this._popupTimeout');
         }
     }

    _escape_translation(str) {
        if (!str) {
            return '';
        }

        let stuff = {
            "\x1B[1m": '<b>',
            "\x1B[22m": '</b>',
            "\x1B[4m": '<u>',
            "\x1B[24m": '</u>'
        };
        str = this._escape_html(str);
        for (let hex in stuff) {
            str = this._replace_all(str, hex, stuff[hex]);
        }
        return str;
    }

    _replace_all(str, find, replace) {
        return (str || '')
            .split(find)
            .join(replace);
    }
    _escape_html(str) {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    async _exec(command) {
        try {
            let proc = new Gio.Subprocess({
                argv: command,
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            proc.init(null);
            return await new Promise((resolve, reject) => {
                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try {
                        let [ok, stdout, stderr] = proc.communicate_utf8_finish(res);
                        resolve(this._escape_translation(stdout));
                    } catch(error) {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            log('Error: ' + command + ' ' + error);
        }
    }

    async _translate(text) {
        //this._cancellable.cancel();
        let cmd = [TRANS_CMD];
        if (this._briefMode)
            cmd.push('-b');
        if (!this._showOriginalPhonetics)
            cmd.push('-show-original-phonetics n')

        cmd.push('-no-browser');
        cmd.push(text);
        return this._exec(cmd);
    }
    /*
    _childFinished(pid, status, _requestObj) {
        this._childWatch = 0;
    }
    async _readStdout() {
        log('read stdout');
        const cnt =
            await this._dataStdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null);

        log(cnt);
        if (cnt === 0) {
            this._stdout.close(null);
            let data = (this._dataStdout.peek_buffer());
            this._result = data;
            //this._notify(data);
            return;
        }

        // Try to read more
        this._dataStdout.set_buffer_size(2 * this._dataStdout.get_buffer_size());
        this._readStdout();
    }

    _translate(text) {
        try {
            let argv = [TRANS_CMD, text];
            let [success_, pid, stdin, stdout, stderr] =
                GLib.spawn_async_with_pipes(null,
                    argv,
                    null,
                    GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                    null);

            this._childPid = pid;
            //this._stdin = new Gio.UnixOutputStream({ fd: stdin, close_fd: true });
            this._stdout = new Gio.UnixInputStream({ fd: stdout, close_fd: true });
            GLib.close(stdin);
            GLib.close(stderr);
            this._dataStdout = new Gio.DataInputStream({ base_stream: this._stdout });

            this._readStdout().then(res => {
                this._notify(res);
            });

            this._childWatch = GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid,
                this._childFinished.bind(this));

        } catch (e) {
            logError(e, 'error while spawning ' + TRANS_CMD);
        }
    }
    */

});

class Extension {
    constructor(uuid) {
        this._uuid = uuid;

        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new TcIndicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}
