NAME = translate-clipboard
UUID = $(NAME)@lsnow.github.io

.PHONY: build install pot test-shell test-prefs remove clean


build: clean
	mkdir -p build/
	cd src && gnome-extensions pack -f \
			--extra-source=../metadata.json \
			--extra-source=../LICENSE \
			--extra-source=../icons \
			--extra-source=./config \
			--extra-source=./extension.js \
			--extra-source=./prefs.js \
			--extra-source=./TcIndicator.js \
			--extra-source=./TranslateWindow.js \
			--extra-source=./google.js \
			--extra-source=./languages.js \
			--extra-source=./llm.js \
			--extra-source=./tts.js \
			--extra-source=./utils.js \
			--extra-source=./stylesheet.css \
			--extra-source=./prefs.css \
			--podir=../po \
			--schema=../schemas/org.gnome.shell.extensions.$(NAME).gschema.xml \
			-o ../build


install: build remove
	gnome-extensions install -f build/$(UUID).shell-extension.zip


pot:
	find src/ -iname "*.js" -printf "%p\n" | sort | \
		xargs xgettext --output=po/$(UUID).pot \
		--from-code=utf-8 --package-name=$(UUID)

	rm -f po/LINGUAS
	for l in $$(ls po/*.po); do \
		basename $$l .po >> po/LINGUAS; \
	done

	cd po && \
	for lang in $$(cat LINGUAS); do \
    	msgconv -t UTF-8 $${lang}.po -o $${lang}.po; \
    	mv $${lang}.po $${lang}.po.old; \
    	msginit --no-translator --locale=$$lang --input $(UUID).pot -o $${lang}.po.new; \
    	msgmerge -N $${lang}.po.old $${lang}.po.new > $${lang}.po; \
    	rm $${lang}.po.old $${lang}.po.new; \
	done


test-shell: install
	env GNOME_SHELL_SLOWDOWN_FACTOR=2 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1500x1000 \
	 	MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 \
		dbus-run-session -- gnome-shell --wayland


test-prefs: install
	gnome-extensions prefs $(UUID)


remove:
	rm -rf $(HOME)/.local/share/gnome-shell/extensions/$(UUID)


clean:
	rm -rf build/ po/*.mo
