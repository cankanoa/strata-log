SHELL := /bin/zsh

.PHONY: help install test clean build-web build-electron build-macos build-windows build-ios sync-ios open-ios

help:
	@echo "Available targets:"
	@echo "  make install         Install project dependencies"
	@echo "  make test            Run the test suite"
	@echo "  make clean           Remove generated build output"
	@echo "  make build-web       Build the shared React app and Electron bundles"
	@echo "  make build-electron  Build the shared React app and Electron bundles"
	@echo "  make build-macos     Package the Electron app for macOS"
	@echo "  make build-windows   Package the Electron app for Windows"
	@echo "  make sync-ios        Sync the web build into the Capacitor iOS shell"
	@echo "  make open-ios        Open the iOS project in Xcode"
	@echo "  make build-ios       Build the web app and sync it into the Capacitor iOS shell"

install:
	npm install

test:
	npm test

clean:
	rm -rf dist dist-electron

build-web:
	npm run build:web

build-electron:
	npm run build:web

build-macos:
	npx tsc -b
	npx vite build
	npx electron-builder --mac

build-windows:
	npx tsc -b
	npx vite build
	npx electron-builder --win

sync-ios:
	npm run cap:sync

open-ios:
	npm run cap:open:ios

build-ios:
	npm run build:web
	npm run cap:sync
