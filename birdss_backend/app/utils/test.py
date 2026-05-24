import os, sys


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.append(PROJECT_ROOT)


from app.scripts.bird_rarity import get_bird_rarity

def main():

    name = "Passer domesticus"
    score = get_bird_rarity(name)
    print(f"Rarity score for {name}: {score}")

if __name__ == "__main__":
    main()
