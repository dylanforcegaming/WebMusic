# WebMusic

<img width="1500" height="1000" alt="WebMusic" src="https://github.com/user-attachments/assets/8f3ddf7f-f03b-47db-8218-05a8af57d168" />

### This web app is avaliable for ANDROID ONLY.

Dependencies Required (the app will not work without them):
- nodejs
- ffmpeg
- python
- clang
- build-essentials
- express
- music-metadata

(If it says no command found, termux will likely provide you with the command to install it ex: npm/nodejs)
________________________________________________

Step 1: Give Termux access to your phone storage
​
Before the server can find your music files, Termux needs permission to look inside your phone's storage. Type this command and hit enter:

```bash
termux-setup-storage
```

A permission pop-up will 'likely' appear on your screen. Tap Allow.
​
________________________________________________

Step 2: Install the required tools
​Your phone needs a few core programs to run the server and build the code. Copy and paste this long command and hit enter:

```
# pkg update && pkg upgrade && pkg install nodejs ffmpeg python clang build-essential
```
________________________________________________
Step 3: Make the folder for WebMusic

```bash
# mkdir webmusic && cd webmusic
```
________________________________________________
Step 4: Install the required packages
​
WebMusic relies on two main packages: Express (to run the web server) and music-metadata (to read your songs' titles, artists, and album art). Install them by running:

```bash'
# npm install express music-metadata
```
________________________________________________
Step 5: Make the script (WebMusic.js)

There is no need to initialize the app, it's one single script.

Now, in the WebMusic folder make a webmusic.js by typing "nano webmusic.js", the GNU text based scripter will popup, Just copy it into the javascript file, and in MUSICDIR put your desired field where your music is stored. (If you use 'SpotiFLAC Mobile' for downloading music, you're files will already be there!). Save with "CTRL - O -> ENTER -> CTRL - X". And now the script is done.
________________________________________________

Last thing to do is... run it!
When you run the script it should say "server running on port:3000" when this pops up, it stared successfully. Go to your wifi settings and click your wifi connection cog, scroll to the bottom at advanced and find your local ip address ex:192.168.1.(phone's ip idenifier).
Enter this address into you're browser along with the port :'3000' at the end, and the app should start up and search for music.

CONGRADS!!! Your music is now playable on your computer.
________________________________________________

The reason I made it? Great question.
It was when I wanted to listen to music and only my laptop had a headphone jack because these days (2026) no phones have headphone jacks anymore :(, so I got my laptop, headphones, and tried to open Spotify or Apple Music, and as I expected, my school blocked it.

So I decided to make my own app, and it can't get blocked. Ever.
I hope you enjoy it, it took blood sweat and tears just to make it read my storage on my phone to my computer 🫠.
With all love - Dylan ♡

