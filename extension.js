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
const { GLib, Gio, GObject, Pango, Clutter, Graphene, St, Meta, Shell } = imports.gi;

const Gettext = imports.gettext.domain(GETTEXT_DOMAIN);
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const MessageTray = imports.ui.messageTray;
const Util = imports.misc.util;

const Prefs = Me.imports.prefs;
const Languages = Me.imports.languages;

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
        this._autoClose = true;

        //this._cancellable = new Gio.Cancellable();

        this._icon = new St.Icon({
            style_class: 'system-status-icon',
        });
        this._icon.gicon = Gio.icon_new_for_string(`${Me.path}/icons/translator-symbolic.svg`);
        let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        box.add_child(this._icon);
        this.add_child(box);

        this._settings = Prefs.SettingsSchema;

        let codes = new PopupMenu.PopupBaseMenuItem({reactive : false,
                                                     can_focus : false});
        this._from = new St.Entry({x_align : Clutter.ActorAlign.START,
                                   hint_text : _("Auto")});
        this._to = new St.Entry({x_align : Clutter.ActorAlign.END,
                                 hint_text : _("Auto")});
        let l = new St.Label ({text: "->",
                               x_expand: true,
                               x_align: Clutter.ActorAlign.CENTER,
                               y_align: Clutter.ActorAlign.CENTER});
        codes.add(this._from);
        codes.add(l);
        codes.add(this._to);
        this.menu.addMenuItem(codes);
        this._from.clutter_text.connect('key-focus-out', ()=> {
            this._settings.set_string(Prefs.Fields.FROM, this._from.text);
        });
        this._to.clutter_text.connect('key-focus-out', ()=> {
            this._settings.set_string(Prefs.Fields.TO, this._to.text);
        });

        let item = new PopupMenu.PopupSwitchMenuItem(_('Toggle translate'), true, null);
        item.connect('toggled', () => {
            this._enabled = item.state;
            this._settings.set_boolean(Prefs.Fields.ENABLE_TRANS, this._enabled);
        });
        this.menu.addMenuItem(item);
        this._enableTransItem = item;

        let item1 = new PopupMenu.PopupSwitchMenuItem(_('Brief mode'), false, null);
        item1.connect('toggled', () => {
            this._briefMode = item1.state;
            this._settings.set_boolean(Prefs.Fields.BRIEF_MODE, this._briefMode);
        });
        this.menu.addMenuItem(item1);
        this._briefModeItem = item1;

        let keybind = new PopupMenu.PopupBaseMenuItem({reactive : false,
                                                       can_focus : false});
        keybind.add(new St.Label({text: "Translate selected",
                                 x_align: Clutter.ActorAlign.START}));
        let key0 = this._settings.get_strv(Prefs.Fields.TRANS_SELECTED)[0];
        keybind.add(new St.Label({text: key0,
                                 x_expand: true,
                                 x_align: Clutter.ActorAlign.END}));

        this.menu.addMenuItem(keybind);

        let settingsItem = new PopupMenu.PopupMenuItem('Settings');
        this.menu.addMenuItem(settingsItem);

        settingsItem.connect("activate", () => {
            Gio.DBus.session.call(
                                  'org.gnome.Shell.Extensions',
                                  '/org/gnome/Shell/Extensions',
                                  'org.gnome.Shell.Extensions',
                                  'OpenExtensionPrefs',
                                  new GLib.Variant('(ssa{sv})', [Me.metadata.uuid, '', {}]),
                                  null,
                                  Gio.DBusCallFlags.NONE,
                                  -1,
                                  null);
        });

        this._settingsChangedId = this._settings.connect('changed', () => {
            this._settingsChanged();
        });
        this._settingsChanged();
        this._watchClipboard();
    }

    destroy() {
        this._removeKeybindings();
        this._selection.disconnect(this._ownerChangedId);
        this._settings.disconnect(this._settingsChangedId);
        if (this._actor)
            this._actor.destroy();
         if (this._popupTimeoutId) {
             GLib.source_remove(this._popupTimeoutId);
             this._popupTimeoutId = 0;
         }
        super.destroy();
    }

    _settingsChanged() {
        this._oldtext = null;
        this._enableTransItem.setToggleState(this._settings.get_boolean(Prefs.Fields.ENABLE_TRANS));
        this._briefModeItem.setToggleState(this._settings.get_boolean(Prefs.Fields.BRIEF_MODE));
        this._enabled = this._enableTransItem.state;
        this._briefMode = this._briefModeItem.state;
        this._autoClose = this._settings.get_boolean(Prefs.Fields.AUTO_CLOSE);

        let from = this._settings.get_string(Prefs.Fields.FROM);
        let to = this._settings.get_string(Prefs.Fields.TO);

        let isoLangs = Languages.isoLangs;

        if (from == '')
            from = 'auto';
        if (to == '')
            to = 'auto';

        if (from != 'auto' && (isoLangs[from] == undefined))
        {
            for (let code in isoLangs)
            {
                if ((isoLangs[code].name.toLowerCase().indexOf(from.toLowerCase()) != -1) ||
                    (isoLangs[code].nativeName.toLowerCase().indexOf(from.toLowerCase) != -1))
                {
                    from = code;
                    break;
                }
            }
        }
        if (isoLangs[from] == undefined)
            from = 'auto';

        if (to != 'auto' && (isoLangs[to] == undefined))
        {
            for (let code in isoLangs)
            {
                if ((isoLangs[code].name.toLowerCase().indexOf(to.toLowerCase()) != -1) ||
                    (isoLangs[code].nativeName.toLowerCase().indexOf(to.toLowerCase()) != -1))
                {
                    to = code;
                    break;
                }
            }
        }
        if (isoLangs[to] == undefined)
            to = 'auto';

        this._from.set_text(from);
        this._to.set_text(to);
        this._removeKeybindings();
        this._setupKeybindings();
    }

    _removeKeybindings() {
        Main.wm.removeKeybinding('translate-selected-text');
    }

    _setupKeybindings() {
        Main.wm.addKeybinding('translate-selected-text',
                              this._settings,
                              Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                              Shell.ActionMode.NORMAL |
                              Shell.ActionMode.POPUP,
                              this._translateSelected.bind(this));
    }

    _translateSelected() {
        let [x, y, mods] = global.get_pointer();
        this._clipboardChanged();
    }

    _watchClipboard() {
        this._selection = global.display.get_selection();
        this._clipboard = St.Clipboard.get_default();
        this._ownerChangedId = this._selection.connect('owner-changed', () => {
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

    _clipboardChanged() {
        this._clipboard.get_text(St.ClipboardType.PRIMARY,
            (clipboard, text) => {
                if (text && text != '' &&
                    text[0] != '/' &&
                    //RegExp(/\S+/).exec(text) &&
                    !Util.findUrls(text).length &&
                    !RegExp(/^[\.\s\d\-]+$/).exec(text)) {
                    this._oldtext = text;
                    [this._x, this._y] = global.get_pointer();
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
        let [x, y] = global.get_pointer();
        */
        let [x, y] = [this._x, this._y];//global.get_pointer();
        if (!this._actor)
        {
            this._actor = new St.Widget();
            this._scroll = new St.ScrollView({ style_class: "translate-scroll",
                                              hscrollbar_policy: St.PolicyType.AUTOMATIC,
                                              vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });
            this._actor.add_child(this._scroll);
            this._box = new St.BoxLayout({ style_class: "translate-box",
                                           vertical: true,
                                           x_expand: true,
                                           y_expand: true });
            this._scroll.add_actor(this._box);

            let closeIcon = new St.Icon({ icon_name: 'window-close-symbolic',
                                        icon_size: 24 });
            this._closeButton = new St.Button({
                                              style_class: 'message-close-button',
                                              child: closeIcon,
            });
            //this._actor.add_child(this._closeButton);
            this._closeButton.connect('clicked', this._close.bind(this));

            this._label = new St.Label();
            this._label.clutter_text.set_markup('test');
            this._label.clutter_text.set_line_wrap(true);
            this._label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
            this._box.add_child(this._label);

            /*
            this._closeButton.add_constraint(new Clutter.BindConstraint({
                                                                        source: this._box,
                                                                        coordinate: Clutter.BindCoordinate.POSITION,
            }));
            this._closeButton.add_constraint(new Clutter.AlignConstraint({
                                                                         source: this._label,
                                                                         align_axis: Clutter.AlignAxis.X_AXIS,
                                                                         pivot_point: new Graphene.Point({ x: 0, y: -1 }),
                                                                         factor: 0,
            }));
            */

            Main.layoutManager.addChrome(this._actor, {affectsInputRegion: true});
        }
        if (this._autoClose)
        {
            this._closeButton.hide();
            this._box.reactive = false;
        }
        else
        {
            this._closeButton.show();
            this._box.reactive = true;
        }
        if (this._popupTimeoutId) {
            GLib.source_remove(this._popupTimeoutId);
            this._popupTimeoutId = 0;
        }
        this._label.clutter_text.set_markup(result);
        let monitor = Main.layoutManager.currentMonitor;
        const { scale_factor: scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
        this._scroll.set_style(
                               'max-height: %spx; max-width: %spx;'.format(monitor.height/scaleFactor/2,
                                                                           monitor.width/scaleFactor/2));
        if (x + this._scroll.get_width() > monitor.x + monitor.width)
        {
            y = monitor.x + monitor.width - this._scroll.get_width();
        }

        if (y + 10 + this._scroll.get_height() > monitor.y + monitor.height)
        {
            y = monitor.y + monitor.height - this._scroll.get_height();
        }
        this._actor.set_position(x, y + 10);
        this._actor.show();
        if (this._autoClose)
            this._updatePopupTimeout(5000);
    }

    _close() {
        this._actor.hide();
    }

    _popupTimeout() {
        let [x, y] = global.get_pointer();
        let [x_, y_] = this._actor.get_transformed_position();
        let [w_, h_] = this._actor.get_transformed_size();
        if (x > x_ && y > y_ &&
            x < x_ + w_ && y < y_ + h_)
        {
            this._updatePopupTimeout(1000);
            return;
        }

        this._actor.hide();
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
        if (this._from.text != '' && this._from.text != 'auto')
        {
            cmd.push('-f');
            cmd.push(this._from.text);
        }
        if (this._to.text != '' && this._to.text != 'auto')
        {
            cmd.push('-t');
            cmd.push(this._to.text);
        }
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
