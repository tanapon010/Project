import os
import cv2
import base64
import numpy as np
import joblib
import mediapipe as mp
import time
from flask import Flask, send_file, request, jsonify, render_template, session

app = Flask(__name__, static_folder='static', template_folder='src')

# In a production environment, this should be a complex, securely stored value.
app.secret_key = 'super-secret-key'

# โหลดโมเดลและตัวเข้ารหัสป้ายกำกับ (label encoder)
try:
    classifier = joblib.load('asl_rf_model.pkl')
    le = joblib.load('label_encoder.pkl')
except FileNotFoundError:
    print("Error: Model files not found. Please make sure 'asl_rf_model.pkl' and 'label_encoder.pkl' are in the same directory.")
    classifier = None
    le = None

# เริ่มต้นใช้งาน Mediapipe Hands
mp_drawing = mp.solutions.drawing_utils
mp_hands = mp.solutions.hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.5
)

STABLE_SECONDS = 2.0

@app.route("/")
def index():
    # Initialize session variables for a new user
    session.setdefault('letter_start', time.time())
    session.setdefault('stable_letter', "")
    session.setdefault('captured_text', "")
    session.setdefault('committed', False)
    session.setdefault('flip_frame', True)
    return render_template('index.html')

def main():
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 80)))

@app.route('/video_feed', methods=['POST'])
def video_feed():
    try:
        if classifier is None or le is None:
            return jsonify({'prediction': 'Error: Model files not loaded', 'captured_text': session.get('captured_text', '')})

        data = request.json['image']
        encoded_data = data.split(',')[1]
        nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        flip_frame = session.get('flip_frame', True)
        if flip_frame:
            frame = cv2.flip(frame, 1)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = mp_hands.process(rgb)

        pred_label = ""

        if res.multi_hand_landmarks:
            lm = res.multi_hand_landmarks[0]
            feat = np.array([[lm.x, lm.y, lm.z] for lm in lm.landmark]).flatten()
            feat = feat.reshape(1, -1)

            prediction = classifier.predict(feat)
            pred_idx = prediction[0]
            pred_label = le.inverse_transform([pred_idx])[0]

        letter_start = session.get('letter_start', time.time())
        stable_letter = session.get('stable_letter', '')
        captured_text = session.get('captured_text', '')
        committed = session.get('committed', False)

        now = time.time()
        if pred_label == stable_letter:
            if now - letter_start > STABLE_SECONDS and not committed:
                if stable_letter.lower() == "space":
                    captured_text += " "
                elif stable_letter.lower() == "del":
                    if len(captured_text) > 0:
                        captured_text = captured_text[:-1]
                else:
                    captured_text += stable_letter
                committed = True
        else:
            stable_letter = pred_label
            letter_start = now
            committed = False

        session['letter_start'] = letter_start
        session['stable_letter'] = stable_letter
        session['captured_text'] = captured_text
        session['committed'] = committed

        return jsonify({
            'prediction': pred_label,
            'captured_text': captured_text
        })

    except Exception as e:
        print(f"Error processing video feed: {e}")
        return jsonify({'prediction': 'Error', 'captured_text': session.get('captured_text', 'Error')})

@app.route('/clear_text', methods=['POST'])
def clear_text():
    session['captured_text'] = ""
    session['committed'] = False
    session['stable_letter'] = ""
    session['letter_start'] = time.time()
    return jsonify({'status': 'success'})

@app.route('/flip_camera', methods=['POST'])
def flip_camera():
    current_flip = session.get('flip_frame', True)
    session['flip_frame'] = not current_flip
    return jsonify({'status': 'success', 'flipped': session['flip_frame']})
    
if __name__ == "__main__":
    main()
