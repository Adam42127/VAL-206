class MetroSoundManager {
    constructor() {
        this._loops = {};
        this._once  = {};
        this._door  = {};

        this.prevSpeed       = 0;
        this.ventiloActive   = false;
        this.finHachPlayed   = false;
        this.pshitStopPlayed = false;
        this.fuActive        = false;

        this._hacheurType  = null;
        this._arretFUAudio = null;

        // Bip 1500 Hz via Web Audio (pas de fichier, pas de CORS)
        this._bipCtx    = null;
        this._bipGain   = null;
        this._bipOsc    = null;
        this._bipActive = false;

        this._init();
    }

    _init() {
        ['Hacheur-depart', 'Hacheur-arrivee', 'ventilo', '30', '50', '70'].forEach(name => {
            const a   = new Audio(`../src/sound/${name}.mp3`);
            a.loop    = true;
            a.volume  = 0;
            a.preload = 'auto';
            this._loops[name] = a;
        });

        ['fin_hach', 'pshit', 'FU', 'ArretFU', 'Desserrage-frein'].forEach(name => {
            const a   = new Audio(`../src/sound/${name}.mp3`);
            a.preload = 'auto';
            this._once[name] = a;
        });

        ['ouv_prt', 'fer_prt', 'buzzer'].forEach(name => {
            const a   = new Audio(`../src/sound/${name}.mp3`);
            a.preload = 'auto';
            this._door[name] = a;
        });
    }

    resume() {}

    // ─── Bip 1500 Hz (0–2 km/h, accélération uniquement) ─────────────────────

    _startBip() {
        if (this._bipActive) return;
        try {
            if (!this._bipCtx) {
                this._bipCtx = new (window.AudioContext || window.webkitAudioContext)();
                this._bipOsc  = this._bipCtx.createOscillator();
                this._bipGain = this._bipCtx.createGain();
                this._bipOsc.type = 'sine';
                this._bipOsc.frequency.value = 1500;
                this._bipGain.gain.value = 0.005;
                this._bipOsc.connect(this._bipGain);
                this._bipGain.connect(this._bipCtx.destination);
                this._bipOsc.start();
            }
            if (this._bipCtx.state === 'suspended') this._bipCtx.resume();
            this._bipGain.gain.value = 0.005;
            this._bipActive = true;
        } catch(e) {}
    }

    _stopBip() {
        if (!this._bipActive) return;
        if (this._bipGain) this._bipGain.gain.value = 0;
        this._bipActive = false;
    }

    // ─── Helpers boucles ─────────────────────────────────────────────────────

    _startLoop(name) {
        const a = this._loops[name];
        if (!a) return;
        if (a.paused) {
            a.currentTime = 0;
            a.play().catch(() => {});
        }
    }

    _stopLoop(name) {
        const a = this._loops[name];
        if (!a) return;
        a.volume = 0;
        a.pause();
        a.currentTime = 0;
    }

    _fadeGain(name, targetVol, ms) {
        const a = this._loops[name];
        if (!a) return;
        const start    = a.volume;
        const target   = Math.max(0, Math.min(3.0, targetVol));
        const duration = ms || 50;
        const t0       = performance.now();
        const step = () => {
            const elapsed  = performance.now() - t0;
            const progress = Math.min(elapsed / duration, 1);
            a.volume = start + (target - start) * progress;
            if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    _setVol(name, vol) {
        const a = this._loops[name];
        if (!a) return;
        a.volume = Math.max(0, Math.min(1, vol));
    }

    _setPitch(name, semitones) {
        const a = this._loops[name];
        if (!a) return;
        a.playbackRate = Math.pow(2, semitones / 12);
    }

    // ─── Sons ponctuels ───────────────────────────────────────────────────────

    _playOnce(name, vol) {
        const a = this._once[name];
        if (!a) return null;
        a.volume      = (vol !== undefined) ? vol : 1;
        a.currentTime = 0;
        a.play().catch(() => {});
        return a;
    }

    // ─── Sons portes ─────────────────────────────────────────────────────────

    playDoorSound(name) {
        const a = this._door[name];
        if (!a) return null;
        a.currentTime = 0;
        a.play().catch(() => {});
        return a;
    }

    // ─── Freins ───────────────────────────────────────────────────────────────

    playBrakeRelease() {
        this._playOnce('Desserrage-frein');
    }

    playBrakeEngage() {
        this._playOnce('pshit', 0.5);
    }

    // ─── FU ───────────────────────────────────────────────────────────────────

    triggerFU(speed) {
        this.fuActive        = true;
        this.pshitStopPlayed = true;   // bloquer pshit à l'arrêt FU
        this.finHachPlayed   = true;   // bloquer fin_hach aussi
        this._stopHacheur();
        this._stopBip();
        this._stopLoop('30');
        this._stopLoop('50');
        this._stopLoop('70');

        if (speed >= 20) {
            const a = this._playOnce('FU', 0.5);
            if (a) {
                a.onended = () => {
                    this._arretFUAudio = this._playOnce('ArretFU');
                    a.onended = null;
                };
            }
        } else {
            this._playOnce('FU', 0.5);
        }
    }

    onFUStop() {
        if (this._arretFUAudio) {
            this._arretFUAudio.pause();
            this._arretFUAudio.currentTime = 0;
            this._arretFUAudio = null;
        }
        this.fuActive = false;
    }

    // ─── Hacheur ─────────────────────────────────────────────────────────────

    _startHacheur(type, targetVol) {
        const name  = type === 'depart'  ? 'Hacheur-depart'  : 'Hacheur-arrivee';
        const other = type === 'depart'  ? 'Hacheur-arrivee' : 'Hacheur-depart';

        if (this._hacheurType !== type) {
            this._stopLoop(other);
            this._hacheurType = type;
            this._loops[name].volume = 0;
            this._startLoop(name);
            this._fadeGain(name, targetVol, 500);
        } else {
            this._fadeGain(name, targetVol, 80);
        }
    }

    _stopHacheur() {
        if (this._hacheurType === 'depart')  this._stopLoop('Hacheur-depart');
        if (this._hacheurType === 'arrivee') this._stopLoop('Hacheur-arrivee');
        this._hacheurType = null;
    }

    // ─── Ventilo — uniquement à 0 km/h exact ─────────────────────────────────

    _startVentilo() {
        if (this.ventiloActive) return;
        this.ventiloActive = true;
        this._loops['ventilo'].volume = 0;
        this._startLoop('ventilo');
        this._fadeGain('ventilo', 0.075, 200);
    }

    _stopVentilo() {
        if (!this.ventiloActive) return;
        this.ventiloActive = false;
        this._stopLoop('ventilo');
    }

    // ─── Update principal ─────────────────────────────────────────────────────

    update(speed, accelLevel, brakesReleased) {
        const prev = this.prevSpeed;

        // Ventilo uniquement à 0 km/h exact
        speed === 0 ? this._startVentilo() : this._stopVentilo();

        // Bip 1500 Hz : entre 0 et 2 km/h, manette en accélération uniquement
        (speed > 0 && speed < 2 && accelLevel > 0)
            ? this._startBip()
            : this._stopBip();

        // FU : tout couper, pas de sons d'arrêt
        if (this.fuActive) {
            this._stopHacheur();
            this._stopBip();
            this._stopLoop('30');
            this._stopLoop('50');
            this._stopLoop('70');
            this.prevSpeed = speed;
            return;
        }

        // ── Hacheur : pas de son si manette en position 0 ───────────────────
        if (!brakesReleased || speed < 2 || accelLevel === 0) {
            this._stopHacheur();

        } else if (accelLevel > 0) {
            const volBase = this._map(accelLevel, 1, 5, 1.0, 3.0);
            let vol = speed >= 50
                ? volBase * Math.max(0, 1 - (speed - 50) / 30)
                : volBase;
            if (vol < 0.01) this._stopHacheur();
            else            this._startHacheur('depart', vol);

        } else {
            // Freinage : progression linéaire niveau 1 (0.333) → niveau 5 (3.0)
            const lv      = Math.abs(accelLevel);
            const volBase = 0.333 + (lv - 1) * (3.0 - 0.333) / 4;
            let vol;
            if (speed > 80)       vol = 0;
            else if (speed >= 50) vol = volBase * (1 - (speed - 50) / 30);
            else                  vol = volBase;
            if (vol < 0.01) this._stopHacheur();
            else            this._startHacheur('arrivee', vol);
        }

        this._updateMotors(speed);
        this._updateStopSounds(speed, prev);
        this.prevSpeed = speed;
    }

    _updateMotors(speed) {
        // 30.mp3 : 13 → 45 km/h
        if (speed >= 13) {
            this._startLoop('30');
            let v;
            if (speed < 20)       v = this._map(speed, 13, 20, 0.05, 1.0);
            else if (speed <= 40) v = 1.0;
            else if (speed <= 45) v = this._map(speed, 40, 45, 1.0, 0.0);
            else                  v = 0;

            if (v < 0.01) {
                this._stopLoop('30');
            } else {
                this._setVol('30', v);
                const pitch = speed < 20
                    ? this._map(speed, 13, 20, -2.5, -2)
                    : this._map(speed, 20, 40, -2, 2);
                this._setPitch('30', pitch);
            }
        } else {
            this._stopLoop('30');
        }

        // 50.mp3 : 40 → 65 km/h
        if (speed >= 40) {
            this._startLoop('50');
            let v;
            if (speed < 45)       v = this._map(speed, 40, 45, 0.02, 0.5);
            else if (speed < 60)  v = 0.5;
            else if (speed <= 65) v = 0.5 * (1 - (speed - 60) / 5);
            else                  v = 0;
            if (v < 0.01) {
                this._stopLoop('50');
            } else {
                this._setVol('50', v);
                this._setPitch('50', this._map(speed, 40, 65, -5, 5));
            }
        } else {
            this._stopLoop('50');
        }

        // 70.mp3 : 60 → 80 km/h
        if (speed >= 60) {
            this._startLoop('70');
            const v = speed < 65 ? (speed - 60) / 5 : 1.0;
            this._setVol('70', v * 0.5);
            this._setPitch('70', this._map(speed, 60, 80, -5, 5));
        } else {
            this._stopLoop('70');
        }
    }

    _updateStopSounds(speed, prev) {
        if (prev >= 2 && speed < 2 && speed > 0 && !this.finHachPlayed) {
            this.finHachPlayed = true;
            this._playOnce('fin_hach');
        }
        if (prev > 0 && speed === 0 && !this.pshitStopPlayed) {
            this.pshitStopPlayed = true;
            this._playOnce('pshit', 0.5);
        }
        if (speed > 3 && !this.fuActive) {
            this.finHachPlayed   = false;
            this.pshitStopPlayed = false;
        }
    }

    // ─── Utilitaire ───────────────────────────────────────────────────────────

    _map(val, inMin, inMax, outMin, outMax) {
        const c = Math.max(inMin, Math.min(inMax, val));
        return outMin + (c - inMin) / (inMax - inMin) * (outMax - outMin);
    }
}
