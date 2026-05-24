import birdnet


def main():
    print("Hello from eco!")


def detect_species():
    model = birdnet.load("acoustic", "2.4", "tf")
    predictions = model.predict("himal.mp3")
    predictions.to_csv("prediction.csv")

    print("predictions", predictions)


if __name__ == "__main__":
    main()
    detect_species()
